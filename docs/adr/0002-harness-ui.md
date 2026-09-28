# ADR 0002：统一 Harness UI 与缺失组件适配

状态：采用。Harness 基线：0.1.7-rc.2。

## 背景

原工作台使用自定义按钮、输入、徽章与 Modal 样式，虽引用宿主颜色仍形成独立控件体系。官方公开 ui-primitives 提供标准组件，但缺少完整的选择器、多行输入及文件选择入口。

## 决定

React 18、TypeScript、CSS Modules、clsx。官方组件通过发布包的公开出口与宿主共享模块使用，固定版本匹配 Harness；缺少的交互使用 Radix Primitives，或以 React 对官方组件进行薄封装。Select 组合 Radix 交互、官方 Button 与 MenuSurface；保留正确的选择语义。所有补充组件仅使用 Harness 主题与排版规范。

用户明确授权引入无样式组件库，优先于官方样式文档中“不添加组件库”的一般约定。仅引入所需 Radix 原语，不采用 Radix Themes、独立色板、全局主题或 Tailwind。

业务页面统一经过 client/ui 组件出口，静态检查禁止直接导入 Radix 或直接使用通用表单控件。官方已有组件保持直用；不复制 Harness 源码，不依赖相邻 checkout。

## 发布与验证

官方组件与 React 外置到宿主，Radix 随客户端构建。CSS Modules 的类名与样式一起生成，样式内嵌客户端并随挂载卸载，不要求宿主另外发现 CSS 文件。官方 UI 包依赖属于 Web 壳构建输入，独立组件测试按官方依赖规则补齐开发依赖；这些依赖不作为插件 UI 的第二份运行时发布。

新增独立 jsdom 组件测试，现有 Node/SQLite 测试继续使用原环境。真实 Harness Web 验证共享模块、主题、浮层和业务流程，jsdom 不作为几何布局或真实宿主证据。无需数据迁移。
