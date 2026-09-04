import { Calculator } from 'lucide-vue-next';
import type { Tool } from '../interface';

export const calculatorTool: Tool = {
  metadata: {
    id: 'calculator',
    name: 'tools.calculator.name',
    description: 'tools.calculator.description',
    icon: Calculator,
    keywords: ['calculator', 'math', 'calc', '科学计算器', '计算器'],
  },
  component: () => import('./CalculatorView.vue'),
  match: () => null,
};
