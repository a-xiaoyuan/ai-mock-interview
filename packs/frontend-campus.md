---
id: frontend-campus
name: 前端 · 校招
description: 前端校招一二面的常见考法：JS 基础、浏览器原理、React、网络与性能优化，加一道场景题。
version: 1
author: xiaoyu
roles: [前端开发]
levels: [校招]
---

## 面试官指引

- 校招重基础：JS 语言机制、浏览器工作原理、框架原理，项目题看候选人是否理解自己用过的东西。
- 一场里 JS 基础、浏览器、框架、网络与性能各最多一道，避免扎堆。
- 框架题跟着简历走：简历写 React 就问 React，写 Vue 就把 React 题换成对应的 Vue 题（响应式原理、diff、nextTick）。
- 场景题选和项目相近的：做过长列表就问虚拟列表，做过表单就问防抖和竞态，做过登录就问鉴权和 XSS / CSRF。
- 手写题（防抖、Promise.all、深拷贝等）口述思路和关键代码即可。

## 评分要点

- 准确性：事件循环的执行顺序、闭包与作用域、this 指向这类有确定答案的题，答错直接 ≤ 2 分。
- 深度：能说出浏览器或框架“为什么这样做”（例如为什么 React 需要 key、为什么 transform 动画不触发重排）才给 4 分以上。
- 实战关联：能结合项目说出用在哪里、怎么验证效果（Performance 面板、Lighthouse 分数、首屏时间等）的加分。
- 表达：能用一个小例子把机制讲清楚的给 4 分以上。

## 题目

### [八股] 事件循环
说说浏览器的事件循环。宏任务和微任务分别有哪些，执行顺序是怎样的？
- 同步代码执行完后，先清空微任务队列，再取一个宏任务执行，如此循环
- 微任务：Promise.then / catch / finally、queueMicrotask、MutationObserver
- 宏任务：setTimeout、setInterval、I/O、UI 事件、MessageChannel
- 每轮宏任务之后、渲染之前会清空微任务；await 之后的代码相当于放进微任务

### [八股] 闭包
什么是闭包？举一个实际用到闭包的例子，闭包会带来什么问题？
- 函数能访问其定义时所在词法作用域中的变量，即使在外部执行
- 应用：防抖节流保存定时器、模块私有变量、柯里化、React Hooks 依赖闭包
- 问题：变量被长期引用无法回收，可能造成内存泄漏
- 经典坑：var 声明的循环变量在回调中共享，用 let 或立即执行函数解决

### [八股] 原型链
JS 的原型链是什么？new 一个对象的过程中发生了什么？
- 每个对象有 __proto__ 指向其构造函数的 prototype，属性查找沿原型链向上直到 null
- new 的过程：创建空对象 → 原型指向构造函数的 prototype → 以该对象为 this 执行构造函数 → 构造函数返回对象则用之，否则返回新对象
- class 是基于原型的语法糖，extends 设置了两条原型链（实例和构造函数本身）
- instanceof 沿原型链判断 prototype 是否出现

### [八股] 渲染流程
从输入 URL 到页面显示，浏览器做了哪些事？重排和重绘有什么区别？
- DNS 解析 → TCP / TLS 建连 → 发送 HTTP 请求 → 接收响应
- 解析 HTML 生成 DOM，解析 CSS 生成 CSSOM，合成渲染树 → 布局 → 绘制 → 合成
- 重排（回流）是几何信息变化需要重新布局，代价大；重绘只改外观不影响布局
- 减少重排：批量修改样式、读写分离避免强制同步布局、动画用 transform / opacity 走合成层

### [八股] React 渲染机制
React 的 diff 算法是怎么做的？列表为什么需要 key，用 index 当 key 有什么问题？
- 同层比较，不跨层移动；类型不同直接替换整棵子树
- 列表通过 key 识别节点，复用相同 key 的节点并计算移动
- 用 index 当 key，在列表头部插入或排序时会导致错误复用，带状态的子组件（如输入框）会串值
- React 18 起 Fiber 架构让渲染可中断，配合并发特性分优先级更新

### [八股] HTTP 缓存
浏览器的强缓存和协商缓存是怎么工作的？对应哪些响应头？
- 强缓存：Cache-Control（max-age、no-cache、no-store）、Expires，命中时不发请求
- 协商缓存：Last-Modified / If-Modified-Since，ETag / If-None-Match，命中返回 304
- no-cache 表示每次都要协商，no-store 才是完全不缓存
- 实践：带 hash 的静态资源设长期强缓存，HTML 用协商缓存

### [八股] 前端安全
XSS 和 CSRF 分别是什么攻击？怎么防御？
- XSS：注入恶意脚本在用户浏览器执行；分存储型、反射型、DOM 型
- XSS 防御：输出转义、避免 innerHTML / dangerouslySetInnerHTML、CSP、Cookie 设 HttpOnly
- CSRF：利用用户已登录的身份，从第三方站点发起请求
- CSRF 防御：SameSite Cookie、CSRF Token、校验 Origin / Referer

### [场景题] 长列表性能
页面要展示一个上万条数据的列表，滚动很卡，你会怎么优化？
- 虚拟列表：只渲染可视区域加缓冲区的节点，用占位高度撑出滚动条
- 不定高时先预估高度，渲染后测量并缓存真实高度
- 分页或无限滚动加载，减少一次性数据量
- 列表项避免不必要的重渲染（memo、稳定的 key 和回调），滚动事件节流或用 IntersectionObserver
- 用 Performance 面板验证优化前后的帧率和长任务

### [场景题] 搜索框
实现一个输入即搜索的搜索框，要注意哪些问题？
- 防抖减少请求次数，并说明防抖和节流的区别
- 竞态：旧请求比新请求晚返回会覆盖结果，用 AbortController 取消或比较请求序号
- 结果缓存、空输入处理、加载和错误状态
- 中文输入法组字期间（compositionstart / compositionend）不触发搜索

### [算法] Promise.all
手写一个 Promise.all，说说思路和需要注意的边界情况。
- 返回新 Promise，遍历输入，每项用 Promise.resolve 包装以兼容非 Promise 值
- 按下标保存结果，计数全部完成后 resolve，保证结果顺序与输入一致
- 任意一个 reject 就立即 reject
- 空数组直接 resolve([])；输入可以是任意可迭代对象
