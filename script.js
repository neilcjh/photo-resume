const API_ROOT = "/api";

const state = {
    isAdminRoute: window.location.pathname.startsWith("/admin"),
    authenticated: false,
    photos: [],
    visiblePhotos: [],
    activeCategory: "全部",
    search: "",
    viewerIndex: 0,
    publicLinks: [],
    selectedShareUrl: "",
    draggedId: ""
};

const elements = {
    adminPanel: document.getElementById("adminPanel"),
    backdrop: document.getElementById("backdrop"),
    authTrigger: document.getElementById("authTrigger"),
    closeAdmin: document.getElementById("closeAdmin"),
    openUpload: document.getElementById("openUpload"),
    uploadInput: document.getElementById("uploadInput"),
    uploadDropzone: document.getElementById("uploadDropzone"),
    searchInput: document.getElementById("searchInput"),
    galleryGrid: document.getElementById("galleryGrid"),
    emptyState: document.getElementById("emptyState"),
    filterChips: document.getElementById("filterChips"),
    manageList: document.getElementById("manageList"),
    restoreBuiltin: document.getElementById("restoreBuiltin"),
    photoForm: document.getElementById("photoForm"),
    photoId: document.getElementById("photoId"),
    titleInput: document.getElementById("titleInput"),
    categoryInput: document.getElementById("categoryInput"),
    tagsInput: document.getElementById("tagsInput"),
    noteInput: document.getElementById("noteInput"),
    resetForm: document.getElementById("resetForm"),
    passwordForm: document.getElementById("passwordForm"),
    currentPasswordInput: document.getElementById("currentPasswordInput"),
    newPasswordInput: document.getElementById("newPasswordInput"),
    logoutButton: document.getElementById("logoutButton"),
    viewer: document.getElementById("viewer"),
    viewerImage: document.getElementById("viewerImage"),
    viewerTitle: document.getElementById("viewerTitle"),
    viewerInfo: document.getElementById("viewerInfo"),
    prevPhoto: document.getElementById("prevPhoto"),
    nextPhoto: document.getElementById("nextPhoto"),
    galleryCardTemplate: document.getElementById("galleryCardTemplate"),
    manageItemTemplate: document.getElementById("manageItemTemplate"),
    modeSubtitle: document.getElementById("modeSubtitle"),
    modeBadge: document.getElementById("modeBadge"),
    publicEntry: document.getElementById("publicEntry"),
    loginDialog: document.getElementById("loginDialog"),
    loginForm: document.getElementById("loginForm"),
    loginPassword: document.getElementById("loginPassword"),
    cancelLogin: document.getElementById("cancelLogin"),
    shareTrigger: document.getElementById("shareTrigger"),
    shareDialog: document.getElementById("shareDialog"),
    shareLinks: document.getElementById("shareLinks"),
    qrImage: document.getElementById("qrImage"),
    shareUrlText: document.getElementById("shareUrlText"),
    copyShareLink: document.getElementById("copyShareLink"),
    closeShare: document.getElementById("closeShare")
};

document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    configureMode();

    try {
        await Promise.all([loadSession(), reloadPhotos()]);
        if (state.isAdminRoute && !state.authenticated) {
            openLoginDialog();
        }
    } catch (error) {
        console.error(error);
        showError("页面初始化失败，请确认后端服务已经启动。");
    }
});

function bindEvents() {
    elements.authTrigger.addEventListener("click", handleAuthTrigger);
    elements.closeAdmin.addEventListener("click", () => toggleAdmin(false));
    elements.backdrop.addEventListener("click", () => toggleAdmin(false));
    elements.openUpload.addEventListener("click", requireAdminThen(() => elements.uploadInput.click()));
    elements.uploadInput.addEventListener("change", (event) => handleUpload(event.target.files));
    elements.uploadDropzone.addEventListener("click", () => elements.uploadInput.click());
    elements.uploadDropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        elements.uploadDropzone.classList.add("dragover");
    });
    elements.uploadDropzone.addEventListener("dragleave", () => {
        elements.uploadDropzone.classList.remove("dragover");
    });
    elements.uploadDropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        elements.uploadDropzone.classList.remove("dragover");
        handleUpload(event.dataTransfer.files);
    });
    elements.searchInput.addEventListener("input", (event) => {
        state.search = event.target.value.trim();
        refreshView();
    });
    elements.restoreBuiltin.addEventListener("click", requireAdminThen(async () => {
        await requestApi(`${API_ROOT}/photos/restore`, { method: "POST" });
        await reloadPhotos();
    }));
    elements.photoForm.addEventListener("submit", savePhotoDetails);
    elements.resetForm.addEventListener("click", clearForm);
    elements.passwordForm.addEventListener("submit", updatePassword);
    elements.logoutButton.addEventListener("click", logout);
    elements.prevPhoto.addEventListener("click", () => changeViewer(-1));
    elements.nextPhoto.addEventListener("click", () => changeViewer(1));
    elements.viewer.addEventListener("close", () => {
        elements.viewerImage.src = "";
    });
    document.addEventListener("keydown", (event) => {
        if (!elements.viewer.open) {
            return;
        }

        if (event.key === "ArrowLeft") {
            changeViewer(-1);
        }
        if (event.key === "ArrowRight") {
            changeViewer(1);
        }
    });
    elements.loginForm.addEventListener("submit", login);
    elements.cancelLogin.addEventListener("click", () => elements.loginDialog.close());
    elements.shareTrigger.addEventListener("click", openShareDialog);
    elements.closeShare.addEventListener("click", () => elements.shareDialog.close());
    elements.copyShareLink.addEventListener("click", copyShareLink);
}

function configureMode() {
    if (state.isAdminRoute) {
        document.body.dataset.mode = "admin";
        elements.modeSubtitle.textContent = "后台管理模式";
        elements.modeBadge.textContent = "ADMIN MODE";
        elements.publicEntry.classList.remove("hidden");
        elements.openUpload.classList.remove("hidden");
        elements.authTrigger.textContent = "登录后台";
    } else {
        document.body.dataset.mode = "public";
        elements.modeSubtitle.textContent = "剧组展示模式";
        elements.modeBadge.textContent = "PUBLIC MODE";
        elements.authTrigger.textContent = "后台登录";
    }
}

async function loadSession() {
    const session = await requestApi(`${API_ROOT}/session`);
    state.authenticated = Boolean(session.authenticated);
    state.publicLinks = session.publicLinks || [];
    state.selectedShareUrl = session.publicLinks?.[0]?.url || window.location.origin;
    syncAuthUi();
}

function syncAuthUi() {
    if (state.isAdminRoute) {
        elements.authTrigger.textContent = state.authenticated ? "管理后台" : "登录后台";
        return;
    }

    elements.authTrigger.textContent = "后台登录";
}

function handleAuthTrigger() {
    if (!state.isAdminRoute) {
        window.location.href = "/admin";
        return;
    }

    if (!state.authenticated) {
        openLoginDialog();
        return;
    }

    toggleAdmin(true);
}

function openLoginDialog() {
    elements.loginPassword.value = "";
    elements.loginDialog.showModal();
}

async function login(event) {
    event.preventDefault();

    try {
        await requestApi(`${API_ROOT}/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                password: elements.loginPassword.value
            })
        });
        state.authenticated = true;
        syncAuthUi();
        elements.loginDialog.close();
        toggleAdmin(true);
    } catch (error) {
        alert(error.message);
    }
}

async function logout() {
    await requestApi(`${API_ROOT}/auth/logout`, { method: "POST" });
    state.authenticated = false;
    syncAuthUi();
    toggleAdmin(false);
    if (state.isAdminRoute) {
        openLoginDialog();
    }
}

async function updatePassword(event) {
    event.preventDefault();

    await requestApi(`${API_ROOT}/auth/password`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            currentPassword: elements.currentPasswordInput.value,
            newPassword: elements.newPasswordInput.value
        })
    });

    elements.passwordForm.reset();
    alert("后台密码已更新。");
}

async function reloadPhotos() {
    const photos = await requestApi(`${API_ROOT}/photos`);
    state.photos = Array.isArray(photos) ? photos : [];
    refreshView();
}

function refreshView() {
    state.visiblePhotos = getVisiblePhotos();
    renderFilterChips();
    renderGallery();
    renderManageList();
}

function getVisiblePhotos() {
    const search = state.search.toLowerCase();
    return [...state.photos]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .filter((photo) => {
            if (state.activeCategory !== "全部" && photo.category !== state.activeCategory) {
                return false;
            }

            if (!search) {
                return true;
            }

            const haystack = [photo.title, photo.category, photo.note, ...(photo.tags || [])]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return haystack.includes(search);
        });
}

function getCategories() {
    const categories = new Set(["全部"]);
    state.photos.forEach((photo) => categories.add(photo.category || "未分类"));
    return [...categories];
}

function renderFilterChips() {
    elements.filterChips.innerHTML = "";
    getCategories().forEach((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `chip${category === state.activeCategory ? " active" : ""}`;
        button.textContent = category;
        button.addEventListener("click", () => {
            state.activeCategory = category;
            refreshView();
        });
        elements.filterChips.appendChild(button);
    });
}

function renderGallery() {
    elements.galleryGrid.innerHTML = "";

    if (!state.visiblePhotos.length) {
        elements.emptyState.classList.remove("hidden");
        return;
    }

    elements.emptyState.classList.add("hidden");

    state.visiblePhotos.forEach((photo, index) => {
        const fragment = elements.galleryCardTemplate.content.cloneNode(true);
        const cardButton = fragment.querySelector(".photo-hitbox");
        const image = fragment.querySelector("img");
        const title = fragment.querySelector(".photo-title");
        const category = fragment.querySelector(".photo-category");
        const note = fragment.querySelector(".photo-note");
        const tags = fragment.querySelector(".photo-tags");

        image.src = photo.src;
        image.alt = photo.title;
        title.textContent = photo.title;
        category.textContent = photo.category || "未分类";
        note.textContent = photo.note || "无备注";

        (photo.tags || []).slice(0, 3).forEach((tagText) => {
            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = tagText;
            tags.appendChild(tag);
        });

        cardButton.addEventListener("click", () => openViewer(index));
        elements.galleryGrid.appendChild(fragment);
    });
}

function renderManageList() {
    elements.manageList.innerHTML = "";

    if (!state.isAdminRoute) {
        return;
    }

    [...state.photos]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .forEach((photo) => {
            const fragment = elements.manageItemTemplate.content.cloneNode(true);
            const item = fragment.querySelector(".manage-item");
            const image = fragment.querySelector("img");
            const title = fragment.querySelector(".manage-title");
            const meta = fragment.querySelector(".manage-meta");
            const editButton = fragment.querySelector(".action-edit");
            const deleteButton = fragment.querySelector(".action-delete");

            item.dataset.id = photo.id;
            image.src = photo.src;
            image.alt = photo.title;
            title.textContent = photo.title;
            meta.textContent = `${photo.category || "未分类"} · 序号 ${photo.sortOrder ?? 0} · ${extractFilename(photo.src)}`;

            editButton.addEventListener("click", () => fillForm(photo));
            deleteButton.addEventListener("click", requireAdminThen(() => deletePhoto(photo.id)));
            item.addEventListener("dragstart", handleDragStart);
            item.addEventListener("dragend", handleDragEnd);
            item.addEventListener("dragover", handleDragOver);
            item.addEventListener("drop", handleDrop);

            elements.manageList.appendChild(fragment);
        });
}

function fillForm(photo) {
    elements.photoId.value = photo.id;
    elements.titleInput.value = photo.title || "";
    elements.categoryInput.value = photo.category || "";
    elements.tagsInput.value = (photo.tags || []).join("、");
    elements.noteInput.value = photo.note || "";
}

function clearForm() {
    elements.photoForm.reset();
    elements.photoId.value = "";
}

async function savePhotoDetails(event) {
    event.preventDefault();
    if (!state.authenticated) {
        openLoginDialog();
        return;
    }

    const photoId = elements.photoId.value;
    if (!photoId) {
        return;
    }

    await requestApi(`${API_ROOT}/photos/${encodeURIComponent(photoId)}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            title: elements.titleInput.value.trim(),
            category: elements.categoryInput.value.trim(),
            tags: parseTags(elements.tagsInput.value),
            note: elements.noteInput.value.trim()
        })
    });

    clearForm();
    await reloadPhotos();
}

function parseTags(value) {
    return value
        .split(/[、,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

async function handleUpload(fileList) {
    if (!state.authenticated) {
        openLoginDialog();
        return;
    }

    const files = [...(fileList || [])];
    if (!files.length) {
        return;
    }

    const formData = new FormData();
    files.forEach((file) => {
        formData.append("files", file);
    });

    await requestApi(`${API_ROOT}/photos`, {
        method: "POST",
        body: formData
    });

    elements.uploadInput.value = "";
    await reloadPhotos();
}

async function deletePhoto(photoId) {
    const photo = state.photos.find((item) => item.id === photoId);
    if (!photo) {
        return;
    }

    const confirmed = window.confirm(`确认删除“${photo.title}”？这会删除服务器上的真实文件。`);
    if (!confirmed) {
        return;
    }

    await requestApi(`${API_ROOT}/photos/${encodeURIComponent(photoId)}`, {
        method: "DELETE"
    });

    if (elements.photoId.value === photoId) {
        clearForm();
    }
    await reloadPhotos();
}

function toggleAdmin(open) {
    if (!state.isAdminRoute) {
        return;
    }

    elements.adminPanel.classList.toggle("open", open);
    elements.backdrop.classList.toggle("hidden", !open);
    elements.adminPanel.setAttribute("aria-hidden", String(!open));
}

function openViewer(index) {
    if (!state.visiblePhotos.length) {
        return;
    }

    state.viewerIndex = index;
    renderViewer();
    elements.viewer.showModal();
}

function changeViewer(step) {
    if (!state.visiblePhotos.length) {
        return;
    }

    state.viewerIndex = (state.viewerIndex + step + state.visiblePhotos.length) % state.visiblePhotos.length;
    renderViewer();
}

function renderViewer() {
    const photo = state.visiblePhotos[state.viewerIndex];
    if (!photo) {
        return;
    }

    elements.viewerImage.src = photo.src;
    elements.viewerImage.alt = photo.title;
    elements.viewerTitle.textContent = photo.title;
    elements.viewerInfo.textContent = [photo.category, ...(photo.tags || []), photo.note].filter(Boolean).join(" · ");
}

function openShareDialog() {
    renderShareLinks();
    updateQrImage();
    elements.shareDialog.showModal();
}

function renderShareLinks() {
    elements.shareLinks.innerHTML = "";
    const links = state.publicLinks.length ? state.publicLinks : [{ label: "当前地址", url: `${window.location.origin}/` }];

    if (!state.selectedShareUrl) {
        state.selectedShareUrl = links[0].url;
    }

    links.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `share-link${entry.url === state.selectedShareUrl ? " active" : ""}`;
        button.textContent = entry.label;
        button.addEventListener("click", () => {
            state.selectedShareUrl = entry.url;
            renderShareLinks();
            updateQrImage();
        });
        elements.shareLinks.appendChild(button);
    });
}

function updateQrImage() {
    const url = state.selectedShareUrl || `${window.location.origin}/`;
    elements.shareUrlText.textContent = url;
    elements.qrImage.src = `${API_ROOT}/share/qr?data=${encodeURIComponent(url)}`;
}

async function copyShareLink() {
    await navigator.clipboard.writeText(state.selectedShareUrl);
    alert("公开链接已复制。");
}

function extractFilename(src) {
    return src.split("/").pop() || src;
}

function handleDragStart(event) {
    state.draggedId = event.currentTarget.dataset.id;
    event.currentTarget.classList.add("dragging");
}

function handleDragEnd(event) {
    event.currentTarget.classList.remove("dragging");
}

function handleDragOver(event) {
    event.preventDefault();
}

async function handleDrop(event) {
    event.preventDefault();
    if (!state.authenticated || !state.draggedId) {
        return;
    }

    const targetId = event.currentTarget.dataset.id;
    if (!targetId || targetId === state.draggedId) {
        return;
    }

    const ordered = [...state.photos].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const fromIndex = ordered.findIndex((photo) => photo.id === state.draggedId);
    const toIndex = ordered.findIndex((photo) => photo.id === targetId);

    if (fromIndex === -1 || toIndex === -1) {
        return;
    }

    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);

    await requestApi(`${API_ROOT}/photos/reorder`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            ids: ordered.map((photo) => photo.id)
        })
    });

    state.draggedId = "";
    await reloadPhotos();
}

function requireAdminThen(callback) {
    return async (...args) => {
        if (!state.authenticated) {
            openLoginDialog();
            return;
        }
        return callback(...args);
    };
}

async function requestApi(url, options = {}) {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401) {
        state.authenticated = false;
        syncAuthUi();
        if (state.isAdminRoute) {
            openLoginDialog();
        }
    }

    if (!response.ok) {
        throw new Error(payload.error || "请求失败");
    }

    return payload;
}

function showError(message) {
    elements.emptyState.classList.remove("hidden");
    elements.emptyState.innerHTML = `
        <strong>服务不可用</strong>
        <p>${message}</p>
    `;
}
