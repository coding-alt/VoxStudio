# VoxStudio

> 基于 Tauri 2 的 macOS 语音克隆桌面工作台，参考 [VoxCPMANE2](https://github.com/0seba/VoxCPMANE2) 后端，采用 Apple 风格 UI。

## 功能特性

- **文本转语音合成**：支持流式合成，边生成边播放
- **音色库浏览与试听**：查看服务端音色并一键试听
- **自定义音色克隆**：上传参考音频，或直接在 App 内用麦克风录制
- **历史记录**：生成记录回放、导出为 WAV
- **波形可视化**：实时波形展示
- **参数调节**：语速、音调等合成参数调节
- **服务监控**：后端状态实时检测 + 一键启停

## 架构

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite 5 |
| 客户端 | Tauri 2（Rust） |
| 后端 | [VoxCPMANE2](https://github.com/0seba/VoxCPMANE2) 服务（独立进程，监听 `http://localhost:8000`） |

前端直连后端 REST API。后端已为 `tauri://localhost` 配置 CORS，无需额外代理或中转层。

### 后端 API（localhost:8000）

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/health` | GET | 健康检查 |
| `/voices` | GET | 音色列表 |
| `/v1/audio/speech` | POST | 合成语音，返回 `audio/wav`（48kHz / 16bit / mono） |
| `/v1/audio/speech/stream` | POST | 流式合成，返回 chunked 裸 PCM `int16` LE（响应头 `X-Sample-Rate: 48000`） |
| `/v1/audio/speech/playback` | POST | 由服务端直接播放 |
| `/v1/audio/speech/cancel` | POST | 取消当前合成 |
| `/v1/voices` | POST / DELETE | 新增 / 删除音色（路径需为服务器可读的绝对路径） |

## 环境要求

- macOS 11+
- Rust 工具链（rustc / cargo）1.70+
- Node.js 18+ 与 npm

```bash
# 安装 Rust 工具链（如本机没有）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 安装与运行

```bash
# 1. 安装前端依赖
npm install

# 2. 开发模式（热更新）
npm run tauri:dev

# 3. 打包
npm run tauri:build
```

打包产物：

- 应用：`src-tauri/target/release/bundle/macos/VoxStudio.app`
- 安装包：`src-tauri/target/release/bundle/dmg/VoxStudio_1.0.0_aarch64.dmg`

## 后端启动

VoxStudio 仅作客户端，需本地先运行 VoxCPMANE2 服务：

```bash
voxcpmane2-server   # 监听 localhost:8000
```

也可在 App 内「设置 → 启动服务」一键拉起（需在设置中填对后端二进制路径，
默认 `/Users/kavin/.local/bin/voxcpmane2-server`）。如果后端已在外部终端运行，App 会自动识别并直接连接，
此时「停止服务」按钮置灰（进程不由 App 管理）。

## 目录结构

```
VoxStudio/
├── src/                  # React 前端
│   ├── components/       # UI 组件（工作台 / 设置 / 音色库 / 历史 / 波形 …）
│   ├── lib/              # API、音频、存储、原生桥接
│   └── styles/           # 全局样式（Apple 风格设计变量）
├── src-tauri/            # Tauri / Rust 原生层
│   ├── src/lib.rs        # 后端启停、文件导入导出、音色管理
│   └── tauri.conf.json   # 应用配置（identifier: com.voxstudio）
├── scripts/              # 图标生成等脚本
└── vite.config.ts       # 前端构建配置
```

## 已知问题

### Tauri 2.11.5 的 DMG 打包 bug

`tauri build` 末尾生成 dmg 时会报错退出，但 **`.app` 在此之前已经打包完成、完全可用**。
这是 Tauri 该版本的已知问题（未释放 `bundle_dmg.sh` 依赖的 `support/` 目录）。
需要 dmg 时可用 `hdiutil` 兜底：

```bash
APP=src-tauri/target/release/bundle/macos/VoxStudio.app
STAGE=$(mktemp -d); cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
hdiutil create -volname VoxStudio -srcfolder "$STAGE" -ov -format UDZO VoxStudio.dmg
```

### 主线程不可阻塞

Tauri 的同步命令运行在主线程。凡是带 `sleep` / 阻塞 IO / 子进程 `wait` 的逻辑
（如等待后端端口就绪、停止子进程），必须写成 `async fn` 并将阻塞部分包进
`tauri::async_runtime::spawn_blocking(...).await`，否则 macOS 会弹出系统风火轮导致界面卡死。

## 许可证

暂未指定开源许可证。如需开源，请自行在仓库中添加 `LICENSE` 文件。
