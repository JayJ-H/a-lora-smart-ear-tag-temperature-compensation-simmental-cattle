import App from './App.vue'
import { createApp } from 'vue'
import { initStore } from './store'                 // Store
import { initRouter } from './router'               // Router
import language from './locales'                    // 国际化
import '@styles/core/tailwind.css'                  // tailwind
import '@styles/index.scss'                         // 样式
import '@utils/sys/console.ts'                      // 控制台输出内容
import { setupGlobDirectives } from './directives'
import { setupErrorHandle } from './utils/sys/error-handle'
import { initDatabaseService } from './services/database' // 数据库服务

document.addEventListener(
  'touchstart',
  function () {},
  { passive: false }
)

const app = createApp(App)

// 初始化数据库（优先初始化）
initDatabaseService().then(() => {
  initStore(app)
  initRouter(app)
  setupGlobDirectives(app)
  setupErrorHandle(app)

  app.use(language)
  app.mount('#app')
}).catch((error) => {
  console.error('应用初始化失败:', error)
  // 即使数据库初始化失败，也继续启动应用
  initStore(app)
  initRouter(app)
  setupGlobDirectives(app)
  setupErrorHandle(app)
  app.use(language)
  app.mount('#app')
})