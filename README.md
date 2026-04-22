# Photo Resume

一个移动端优先的照片简历应用，包含两种模式：

- 公开展示页：给剧组、导演、选角现场查看
- 后台管理页：登录后上传、删除、编辑、拖拽排序

## 功能

- 公开展示与管理后台分离
- 密码保护后台
- 批量上传和拖拽排序
- 删除服务器真实图片文件
- 局域网分享链接和二维码
- 离线二维码生成，不依赖第三方二维码网站

## 本地运行

要求：

- Node.js 20+

安装依赖：

```bash
npm install
```

启动：

```bash
npm start
```

访问：

- 公开页：`http://localhost:8080/`
- 后台：`http://localhost:8080/admin`

如果 `8080` 被占用，服务会自动尝试下一个端口。

## 默认后台密码

首次启动如果没有 `data/admin.json`，系统会自动创建默认密码：

```text
admin123456
```

进入后台后建议立即修改。

## 环境变量

参考 `.env.example`

- `PORT`：服务端口
- `STORAGE_DIR`：持久化目录，上传图片和后台配置会写到这里
- `PUBLIC_BASE_URL`：公开访问域名，用于二维码和分享链接
- `ADMIN_PASSWORD`：部署时初始化后台密码
- `ADMIN_PASSWORD_HASH`：直接提供 SHA-256 密码哈希

## 保留的平台

为了降低复杂度，仓库现在只保留 **Render** 这一套部署配置：

- `render.yaml`

## GitHub 上传和首次部署清单

### 1. 准备 GitHub 仓库

1. 在 GitHub 新建一个仓库，比如 `photo-resume`
2. 把当前项目文件上传到仓库根目录
3. 确认这些文件已经提交：
   - `index.html`
   - `styles.css`
   - `script.js`
   - `server.js`
   - `package.json`
   - `package-lock.json`
   - `render.yaml`
   - `data/photos.json`
   - `images/` 里的初始展示图片

### 2. 不要上传这些内容

- `node_modules/`
- `.env`
- `data/admin.json`
- `uploads/`
- `storage/`

这些已经在 `.gitignore` 里处理好了。

### 3. 在 Render 创建项目

1. 打开 Render
2. 选择 `New +`
3. 选择 `Blueprint`
4. 连接你的 GitHub 账号
5. 选中刚才上传的仓库
6. Render 会自动读取 `render.yaml`

### 4. 配置环境变量

第一次部署时至少设置：

- `ADMIN_PASSWORD`
- `PUBLIC_BASE_URL`

建议填写方式：

- `ADMIN_PASSWORD`：你自己的后台密码
- `PUBLIC_BASE_URL`：Render 给你的正式网址，例如 `https://your-app-name.onrender.com`

### 5. 配置持久化存储

如果你希望后台上传的新照片、后台密码配置、排序结果在重启后仍然保留，需要给 Render 挂载持久化磁盘。

建议：

1. 在 Render 服务中添加 persistent disk
2. 挂载目录使用 `/opt/render/project/src/storage`
3. 保持 `STORAGE_DIR=/opt/render/project/src/storage`

不挂磁盘的后果：

- 重新部署后，上传的图片和后台配置可能丢失

### 6. 部署完成后检查

部署完成后按下面顺序检查：

1. 打开公开页 `/`
2. 打开后台 `/admin`
3. 用你设置的 `ADMIN_PASSWORD` 登录
4. 上传一张测试图片
5. 修改标题和分类
6. 拖拽调整顺序
7. 打开“扫码分享”，确认二维码和公开链接正常

### 7. 首次上线后建议立刻做的事

1. 在后台重新修改一次密码
2. 上传 1 到 3 张测试图，确认持久化正常
3. 删除测试图，确认删除也正常
4. 用手机访问公开链接，确认剧组看到的是公开页而不是后台

## 项目结构

```text
.
├─ data/
│  └─ photos.json
├─ images/
├─ index.html
├─ script.js
├─ server.js
├─ styles.css
├─ package.json
├─ package-lock.json
└─ render.yaml
```
