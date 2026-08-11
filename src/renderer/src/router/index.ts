import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const Login = () => import('../views/Login.vue');
const Sync = () => import('../views/Sync.vue');

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/sync' },
  { path: '/login', name: 'login', component: Login },
  { path: '/sync', name: 'sync', component: Sync }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) {
    await auth.refresh();
  }
  if (to.path !== '/login' && !auth.loggedIn) {
    return { path: '/login' };
  }
  if (to.path === '/login' && auth.loggedIn) {
    return { path: '/sync' };
  }
});
