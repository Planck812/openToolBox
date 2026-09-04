import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import ToolView from '@/views/ToolView.vue';
import SettingsView from '@/views/SettingsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/tool/:id',
      name: 'tool',
      component: ToolView,
      meta: {
        keepAlive: true,
      },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
    },
  ],
});

export default router;
