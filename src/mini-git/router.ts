import { createRouter, createWebHashHistory } from 'vue-router';
import RepoPickerView from './views/RepoPickerView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

const routes = [
  {
    path: '/',
    name: 'picker',
    component: RepoPickerView,
  },
  {
    path: '/workspace',
    name: 'workspace',
    component: WorkspaceView,
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

export default router;
