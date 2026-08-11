import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import Login from '../views/Login.vue';
import Sync from '../views/Sync.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/sync' },
  { path: '/login', name: 'login', component: Login },
  { path: '/sync', name: 'sync', component: Sync }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes
});
