// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxtjs/color-mode', '@nuxtjs/i18n'],
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      titleTemplate: '%s - 免费临时邮箱服务',
      htmlAttrs: {
        lang: 'zh-CN'
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'theme-color', content: '#4f46e5' },
        { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }
      ],
      link: [
        { rel: 'icon', type: 'image/png', href: '/email-logo.png' },
        { rel: 'apple-touch-icon', href: '/email-logo.png' }
      ],
      // script: [
      //   {
      //     src: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5158791103395695",
      //     crossorigin: "anonymous",
      //     async: true
      //   }
      //   // 示例：{ src: 'https://example.com/script.js', async: true }
      // ]
    }
  },
  vite: {
    plugins: [
      tailwindcss(),
    ],
  },
  // 路由规则: 对于首页开启预渲染
  nitro: {
    prerender: {
      routes: ['/'],
      // 忽略找不到的页面路径错误
      ignore: [
        '/privacy', 
        '/terms', 
        '/disclaimer', 
        '/contact'
      ]
    }
  },
  // 自定义SEO配置
  runtimeConfig: {
    public: {
      siteUrl: 'https://temp-email.top',
      workerUrl: 'https://email-worker.1850278148.workers.dev'
      // workerUrl: 'email-worker.1850278148.workers.dev'
    }
  },
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'temp-email-color-mode'
  },
  i18n: {
    locales: [
      {
        code: 'en',
        iso: 'en-US',
        name: 'English',
        file: 'en.json'
      },
      {
        code: 'zh',
        iso: 'zh-CN',
        name: '中文',
        file: 'zh.json'
      }
    ],
    defaultLocale: 'zh',
  }
})