const http = require("http");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { pathToFileURL } = require("url");

const HOST = "0.0.0.0";
const DEFAULT_PORT = Number(process.env.PORT || 8080);
const ROOT_DIR = __dirname;
const BUILTIN_IMAGES_DIR = path.join(ROOT_DIR, "images");
const STORAGE_DIR = process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : ROOT_DIR;
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(STORAGE_DIR, "uploads");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(STORAGE_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "photos.json");
const ADMIN_FILE = path.join(DATA_DIR, "admin.json");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_ADMIN_PASSWORD_HASH = "ac0e7d037817094e9e0b4441f9bae3209d67b02fa484917065f71b16109a1a78";

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
};

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const RESERVED_IMAGE_NAMES = new Set(["ME.jpg", "ME.png"]);
const sessions = new Map();
let currentPort = DEFAULT_PORT;

async function main() {
    await ensureFiles();
    await startServerWithFallback(DEFAULT_PORT);
}

async function startServerWithFallback(initialPort) {
    const explicitPort = Boolean(process.env.PORT);
    let port = initialPort;

    while (true) {
        const server = http.createServer(handleRequest);

        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(port, HOST, resolve);
            });
            currentPort = port;
            console.log(`Photo resume server running at http://localhost:${port}`);
            return;
        } catch (error) {
            server.close();

            if (error.code !== "EADDRINUSE" || explicitPort) {
                throw error;
            }

            port += 1;
        }
    }
}

async function handleRequest(req, res) {
    try {
        cleanupSessions();
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        if (url.pathname.startsWith("/api/")) {
            await handleApi(req, res, url);
            return;
        }

        await serveStatic(url.pathname, res);
    } catch (error) {
        if (error && error.code === "HANDLED_RESPONSE") {
            return;
        }
        console.error(error);
        sendJson(res, 500, { error: error.message || "Server error" });
    }
}

async function handleApi(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
        sendJson(res, 200, {
            authenticated: isAuthenticated(req),
            publicLinks: getPublicLinks()
        });
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
        const payload = await readJsonBody(req);
        const admin = await readAdminConfig();
        const hash = sha256(String(payload.password || ""));
        if (hash !== admin.passwordHash) {
            sendJson(res, 401, { error: "密码错误" });
            return;
        }

        const sessionId = crypto.randomBytes(24).toString("hex");
        sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_MS });
        setSessionCookie(res, sessionId);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        clearSession(req, res);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === "PUT" && url.pathname === "/api/auth/password") {
        requireAuth(req, res);
        const payload = await readJsonBody(req);
        await updatePassword(payload.currentPassword, payload.newPassword);
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/photos") {
        const photos = await loadPhotos();
        sendJson(res, 200, photos);
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/photos") {
        requireAuth(req, res);
        const created = await createPhotosFromUpload(req);
        sendJson(res, 201, created);
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/photos/restore") {
        requireAuth(req, res);
        await restorePhotos();
        sendJson(res, 200, await loadPhotos());
        return;
    }

    if (req.method === "PUT" && url.pathname === "/api/photos/reorder") {
        requireAuth(req, res);
        const payload = await readJsonBody(req);
        const reordered = await reorderPhotos(payload.ids);
        sendJson(res, 200, reordered);
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/share/qr") {
        const data = url.searchParams.get("data");
        if (!data) {
            sendJson(res, 400, { error: "Missing QR data" });
            return;
        }

        const svg = await generateQrSvg(data);
        res.writeHead(200, {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "no-store"
        });
        res.end(svg);
        return;
    }

    const match = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (!match) {
        sendJson(res, 404, { error: "Not found" });
        return;
    }

    const photoId = decodeURIComponent(match[1]);

    if (req.method === "PUT") {
        requireAuth(req, res);
        const payload = await readJsonBody(req);
        const updated = await updatePhoto(photoId, payload);
        sendJson(res, 200, updated);
        return;
    }

    if (req.method === "DELETE") {
        requireAuth(req, res);
        await deletePhoto(photoId);
        sendJson(res, 200, { ok: true });
        return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
}

async function serveStatic(requestPath, res) {
    let safePath = decodeURIComponent(requestPath);
    if (safePath === "/" || safePath === "/admin") {
        safePath = "/index.html";
    }

    try {
        const filePath = safePath.startsWith("/uploads/")
            ? resolveUploadsPath(safePath)
            : resolveSafePath(safePath);
        const file = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
            "Cache-Control": ext.startsWith(".jp") || ext === ".png" || ext === ".webp" ? "no-cache" : "no-store"
        });
        res.end(file);
    } catch (error) {
        if (error && error.code === "ENOENT") {
            sendJson(res, 404, { error: "File not found" });
            return;
        }
        throw error;
    }
}

function resolveSafePath(requestPath) {
    const normalized = path
        .normalize(requestPath)
        .replace(/^(\.\.(\/|\\|$))+/, "")
        .replace(/^[/\\]+/, "");
    const filePath = path.join(ROOT_DIR, normalized);
    if (!filePath.startsWith(ROOT_DIR)) {
        throw new Error("Invalid path");
    }
    return filePath;
}

function resolveUploadsPath(requestPath) {
    const normalized = path
        .normalize(requestPath)
        .replace(/^(\.\.(\/|\\|$))+/, "")
        .replace(/^[/\\]+/, "");
    const filePath = path.join(STORAGE_DIR, normalized);
    if (!filePath.startsWith(STORAGE_DIR)) {
        throw new Error("Invalid upload path");
    }
    return filePath;
}

async function ensureFiles() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    try {
        await fs.access(DATA_FILE);
    } catch {
        await fs.writeFile(DATA_FILE, "[]\n", "utf8");
    }

    try {
        await fs.access(ADMIN_FILE);
    } catch {
        await fs.writeFile(
            ADMIN_FILE,
            `${JSON.stringify({
                passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
                updatedAt: new Date().toISOString()
            }, null, 2)}\n`,
            "utf8"
        );
    }
}

async function readAdminConfig() {
    await ensureFiles();
    const config = JSON.parse(await fs.readFile(ADMIN_FILE, "utf8"));
    const envHash = process.env.ADMIN_PASSWORD_HASH;
    const envPassword = process.env.ADMIN_PASSWORD;

    if (envHash) {
        return {
            ...config,
            passwordHash: envHash
        };
    }

    if (envPassword) {
        return {
            ...config,
            passwordHash: sha256(envPassword)
        };
    }

    return config;
}

async function updatePassword(currentPassword, newPassword) {
    if (!newPassword || String(newPassword).trim().length < 6) {
        throw new Error("新密码至少 6 位");
    }

    const admin = await readAdminConfig();
    if (sha256(String(currentPassword || "")) !== admin.passwordHash) {
        throw new Error("当前密码错误");
    }

    admin.passwordHash = sha256(String(newPassword));
    admin.updatedAt = new Date().toISOString();
    await fs.writeFile(ADMIN_FILE, `${JSON.stringify(admin, null, 2)}\n`, "utf8");
}

async function loadPhotos() {
    await ensureFiles();
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const stored = JSON.parse(raw || "[]");
    const synced = await syncPhotosWithImages(Array.isArray(stored) ? stored : []);
    await savePhotos(synced);
    return synced;
}

async function savePhotos(photos) {
    const serialized = JSON.stringify(sortPhotos(photos), null, 2);
    await fs.writeFile(DATA_FILE, `${serialized}\n`, "utf8");
}

async function syncPhotosWithImages(storedPhotos) {
    const existingImages = await listCurrentImages();
    const bySource = new Map(storedPhotos.map((photo) => [photo.src || "", photo]));
    const synced = [];
    let nextSortOrder = 1;

    for (const image of existingImages) {
        const existing = bySource.get(image.src);
        if (existing) {
            synced.push({
                ...existing,
                src: image.src,
                sortOrder: Number.isFinite(existing.sortOrder) ? existing.sortOrder : nextSortOrder
            });
        } else {
            synced.push(createPhotoRecord(image.src, nextSortOrder, image.sourceType));
        }
        nextSortOrder += 1;
    }

    return sortPhotos(synced).map((photo, index) => ({
        ...photo,
        sortOrder: index + 1
    }));
}

async function listCurrentImages() {
    const builtinFiles = await fs.readdir(BUILTIN_IMAGES_DIR, { withFileTypes: true });
    const uploadsFiles = fsSync.existsSync(UPLOADS_DIR)
        ? await fs.readdir(UPLOADS_DIR, { withFileTypes: true })
        : [];

    const builtinImages = builtinFiles
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .filter((name) => !RESERVED_IMAGE_NAMES.has(name))
        .map((filename) => ({
            src: `images/${filename}`,
            sourceType: "builtin"
        }));

    const uploadedImages = uploadsFiles
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .map((filename) => ({
            src: `uploads/${filename}`,
            sourceType: "upload"
        }));

    return [...builtinImages, ...uploadedImages];
}

function createPhotoRecord(src, sortOrder, sourceType) {
    const title = path.parse(path.basename(src)).name;
    return {
        id: `photo-${slugify(title)}-${Date.now().toString(36)}`,
        src,
        title,
        category: "未分类",
        tags: [],
        note: "",
        sourceType: sourceType || "builtin",
        createdAt: new Date().toISOString(),
        sortOrder
    };
}

async function createPhotosFromUpload(req) {
    const formData = await readFormData(req);
    const files = formData.getAll("files");

    if (!files.length) {
        throw new Error("没有上传文件");
    }

    const photos = await loadPhotos();
    const created = [];
    let nextSortOrder = photos.length + 1;

    for (const file of files) {
        if (!file || typeof file.name !== "string") {
            continue;
        }

        const ext = path.extname(file.name).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) {
            continue;
        }

        const filename = buildUploadFilename(file.name);
        const savePath = path.join(UPLOADS_DIR, filename);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(savePath, buffer);

        created.push({
            id: `photo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            src: `uploads/${filename}`,
            title: path.parse(file.name).name,
            category: "新增",
            tags: ["新增"],
            note: "",
            sourceType: "upload",
            createdAt: new Date().toISOString(),
            sortOrder: nextSortOrder
        });
        nextSortOrder += 1;
    }

    const merged = [...photos, ...created];
    await savePhotos(merged);
    return created;
}

async function updatePhoto(photoId, payload) {
    const photos = await loadPhotos();
    const index = photos.findIndex((photo) => photo.id === photoId);
    if (index === -1) {
        throw new Error("照片不存在");
    }

    const current = photos[index];
    const updated = {
        ...current,
        title: typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : current.title,
        category: typeof payload.category === "string" && payload.category.trim() ? payload.category.trim() : "未分类",
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag).trim()).filter(Boolean) : current.tags,
        note: typeof payload.note === "string" ? payload.note.trim() : current.note
    };

    photos[index] = updated;
    await savePhotos(photos);
    return updated;
}

async function reorderPhotos(ids) {
    if (!Array.isArray(ids) || !ids.length) {
        throw new Error("排序参数无效");
    }

    const photos = await loadPhotos();
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const reordered = ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((photo, index) => ({
            ...photo,
            sortOrder: index + 1
        }));

    if (reordered.length !== photos.length) {
        throw new Error("排序数量不匹配");
    }

    await savePhotos(reordered);
    return reordered;
}

async function deletePhoto(photoId) {
    const photos = await loadPhotos();
    const target = photos.find((photo) => photo.id === photoId);
    if (!target) {
        throw new Error("照片不存在");
    }

    const filename = path.basename(target.src || "");

    if (RESERVED_IMAGE_NAMES.has(filename)) {
        throw new Error("保留图片不能删除");
    }

    const targetPath = resolveImageSourcePath(target.src);

    await fs.rm(targetPath, { force: true });
    const remaining = photos.filter((photo) => photo.id !== photoId);
    await savePhotos(
        remaining.map((photo, index) => ({
            ...photo,
            sortOrder: index + 1
        }))
    );
}

async function restorePhotos() {
    const photos = await loadPhotos();
    const synced = await syncPhotosWithImages(photos);
    await savePhotos(synced);
}

function sortPhotos(photos) {
    return [...photos].sort((a, b) => {
        const orderA = Number.isFinite(a.sortOrder) ? a.sortOrder : Number.MAX_SAFE_INTEGER;
        const orderB = Number.isFinite(b.sortOrder) ? b.sortOrder : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}

function slugify(value) {
    return value
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "photo";
}

function buildUploadFilename(originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const base = path.parse(originalName).name;
    const safeBase = slugify(base);
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return `${safeBase}-${stamp}${ext}`;
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCookies(req) {
    const header = req.headers.cookie || "";
    return Object.fromEntries(
        header
            .split(";")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
                const [key, ...rest] = item.split("=");
                return [key, rest.join("=")];
            })
    );
}

function isAuthenticated(req) {
    const sid = parseCookies(req).sid;
    const session = sid ? sessions.get(sid) : null;
    return Boolean(session && session.expiresAt > Date.now());
}

function requireAuth(req, res) {
    if (!isAuthenticated(req)) {
        sendJson(res, 401, { error: "请先登录后台" });
        const error = new Error("Unauthorized");
        error.code = "HANDLED_RESPONSE";
        throw error;
    }
}

function setSessionCookie(res, sid) {
    res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`);
}

function clearSession(req, res) {
    const sid = parseCookies(req).sid;
    if (sid) {
        sessions.delete(sid);
    }
    res.setHeader("Set-Cookie", "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function cleanupSessions() {
    const now = Date.now();
    for (const [sid, session] of sessions.entries()) {
        if (session.expiresAt <= now) {
            sessions.delete(sid);
        }
    }
}

function getPublicLinks() {
    const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
    if (publicBaseUrl) {
        return [{ label: "公开地址", url: normalizePublicUrl(publicBaseUrl) }];
    }

    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
    if (railwayDomain) {
        return [{ label: "Railway 公网地址", url: normalizePublicUrl(`https://${railwayDomain}`) }];
    }

    const flyAppName = process.env.FLY_APP_NAME?.trim();
    if (flyAppName) {
        return [{ label: "Fly.io 公网地址", url: normalizePublicUrl(`https://${flyAppName}.fly.dev`) }];
    }

    const links = [{ label: "当前设备", url: `http://localhost:${currentPort}/` }];
    const interfaces = os.networkInterfaces();
    const seen = new Set();

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family !== "IPv4" || entry.internal) {
                continue;
            }
            const url = `http://${entry.address}:${currentPort}/`;
            if (seen.has(url)) {
                continue;
            }
            seen.add(url);
            links.push({ label: `${name} ${entry.address}`, url });
        }
    }

    return links;
}

function normalizePublicUrl(value) {
    return value.endsWith("/") ? value : `${value}/`;
}

function resolveImageSourcePath(src) {
    if (src.startsWith("images/")) {
        return path.join(BUILTIN_IMAGES_DIR, path.basename(src));
    }
    if (src.startsWith("uploads/")) {
        return path.join(UPLOADS_DIR, path.basename(src));
    }
    throw new Error("Invalid image source");
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
}

async function readFormData(req) {
    const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: req,
        duplex: "half"
    });
    return request.formData();
}

async function generateQrSvg(value) {
    const moduleUrl = pathToFileURL(path.join(ROOT_DIR, "node_modules", "qrcode", "lib", "server.js")).href;
    const qrcode = await import(moduleUrl);
    return qrcode.toString(value, {
        type: "svg",
        margin: 1,
        width: 320
    });
}

function sendJson(res, status, payload) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(payload));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
