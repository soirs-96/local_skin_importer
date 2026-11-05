import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/hextech.css';
import { router } from './router';
import App from './App.vue';
import { installConsoleCapture } from './composables/useConsoleCapture';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(ElementPlus);
app.use(router);
// 尽早接管 console —— 用户撞错之后过一会儿才想起来打开控制台,早装一秒就多留一秒现场。
installConsoleCapture(pinia);
app.mount('#app');
