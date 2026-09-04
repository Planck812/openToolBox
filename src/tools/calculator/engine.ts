import i18n from '@/i18n';

export type CalculatorMode = 'basic' | 'scientific';
export type CalculatorResultStatus = 'value' | 'error';

export type CalculatorHistoryItem = {
  id: string;
  expression: string;
  result: string;
  order: number;
};

export type CalculatorState = {
  mode: CalculatorMode;
  expression: string;
  display: string;
  status: CalculatorResultStatus;
  history: CalculatorHistoryItem[];
};

type CalculatorEngineOptions = {
  mode?: CalculatorMode;
  expression?: string;
  display?: string;
  status?: CalculatorResultStatus;
  history?: CalculatorHistoryItem[];
};

type OperatorInfo = {
  precedence: number;
  associativity: 'left' | 'right';
  argCount: number;
};

const MAX_HISTORY = 10;
const ERROR_MESSAGE = i18n.global.t('tools.calculator.error_message');
const PI_VALUE = Math.PI;
const SCIENTIFIC_FUNCTIONS = new Set(['sin', 'cos', 'tan', 'sqrt']);
const OPERATOR_INFO: Record<string, OperatorInfo> = {
  '+': { precedence: 1, associativity: 'left', argCount: 2 },
  '-': { precedence: 1, associativity: 'left', argCount: 2 },
  '*': { precedence: 2, associativity: 'left', argCount: 2 },
  '/': { precedence: 2, associativity: 'left', argCount: 2 },
  '^': { precedence: 3, associativity: 'right', argCount: 2 },
  'u-': { precedence: 4, associativity: 'right', argCount: 1 },
};

const isNumericToken = (token: string) => /^(\d+(\.\d+)?|\.\d+)$/.test(token);
const isFunctionToken = (token: string) => SCIENTIFIC_FUNCTIONS.has(token);

const trimTrailingZeros = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error('invalid-number');
  }

  const rounded = Number(value.toFixed(6));
  if (Object.is(rounded, -0)) {
    return '0';
  }
  return rounded.toString();
};

const isOperandEnd = (char?: string) => {
  if (!char) return false;
  return /\d|\)|i/.test(char);
};

const findMatchingLeftParen = (expression: string, rightIndex: number) => {
  let depth = 0;
  for (let index = rightIndex; index >= 0; index -= 1) {
    const char = expression[index];
    if (char === ')') {
      depth += 1;
    } else if (char === '(') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
};

const findLastOperandRange = (expression: string) => {
  if (!expression) {
    return null;
  }

  let end = expression.length;
  while (end > 0 && expression[end - 1] === ' ') {
    end -= 1;
  }

  if (end === 0) {
    return null;
  }

  const lastChar = expression[end - 1];
  if (lastChar === ')') {
    const start = findMatchingLeftParen(expression, end - 1);
    if (start === -1) {
      return null;
    }

    let functionStart = start;
    while (functionStart > 0 && /[a-z]/i.test(expression[functionStart - 1])) {
      functionStart -= 1;
    }

    return { start: functionStart, end };
  }

  if (/[a-z]/i.test(lastChar)) {
    let start = end - 1;
    while (start > 0 && /[a-z]/i.test(expression[start - 1])) {
      start -= 1;
    }
    return { start, end };
  }

  let start = end - 1;
  while (start > 0 && /[\d.]/.test(expression[start - 1])) {
    start -= 1;
  }
  return { start, end };
};

const tokenize = (expression: string) => {
  const tokens: string[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];

    if (char === ' ') {
      index += 1;
      continue;
    }

    if (/[\d.]/.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /[\d.]/.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      tokens.push(value);
      continue;
    }

    if (/[a-z]/i.test(char)) {
      let value = char;
      index += 1;
      while (index < expression.length && /[a-z]/i.test(expression[index])) {
        value += expression[index];
        index += 1;
      }
      tokens.push(value);
      continue;
    }

    if ('+-*/^()'.includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }

    throw new Error('invalid-token');
  }

  return tokens;
};

const toRpn = (tokens: string[]) => {
  const output: string[] = [];
  const operators: string[] = [];
  let previous: string | null = null;

  for (const token of tokens) {
    if (isNumericToken(token) || token === 'pi') {
      output.push(token);
      previous = token;
      continue;
    }

    if (isFunctionToken(token)) {
      operators.push(token);
      previous = token;
      continue;
    }

    if (token === '(') {
      operators.push(token);
      previous = token;
      continue;
    }

    if (token === ')') {
      while (operators.length && operators[operators.length - 1] !== '(') {
        output.push(operators.pop() as string);
      }

      if (!operators.length) {
        throw new Error('mismatch-paren');
      }

      operators.pop();
      if (operators.length && isFunctionToken(operators[operators.length - 1])) {
        output.push(operators.pop() as string);
      }
      previous = token;
      continue;
    }

    let operator = token;
    if (
      operator === '-' &&
      (!previous || (previous in OPERATOR_INFO) || previous === '(' || isFunctionToken(previous))
    ) {
      operator = 'u-';
    }

    const current = OPERATOR_INFO[operator];
    if (!current) {
      throw new Error('unsupported-operator');
    }

    while (operators.length) {
      const top = operators[operators.length - 1];
      const topInfo = OPERATOR_INFO[top];
      if (!topInfo) {
        break;
      }

      const higherPrecedence = topInfo.precedence > current.precedence;
      const sameAndLeft = topInfo.precedence === current.precedence && current.associativity === 'left';
      if (!higherPrecedence && !sameAndLeft) {
        break;
      }

      output.push(operators.pop() as string);
    }

    operators.push(operator);
    previous = operator;
  }

  while (operators.length) {
    const item = operators.pop() as string;
    if (item === '(' || item === ')') {
      throw new Error('mismatch-paren');
    }
    output.push(item);
  }

  return output;
};

const evaluateRpn = (tokens: string[]) => {
  const stack: number[] = [];

  for (const token of tokens) {
    if (isNumericToken(token)) {
      stack.push(Number(token));
      continue;
    }

    if (token === 'pi') {
      stack.push(PI_VALUE);
      continue;
    }

    if (token === 'u-') {
      const value = stack.pop();
      if (value === undefined) {
        throw new Error('missing-operand');
      }
      stack.push(-value);
      continue;
    }

    if (isFunctionToken(token)) {
      const value = stack.pop();
      if (value === undefined) {
        throw new Error('missing-operand');
      }

      switch (token) {
        case 'sin':
          stack.push(Math.sin((value * Math.PI) / 180));
          break;
        case 'cos':
          stack.push(Math.cos((value * Math.PI) / 180));
          break;
        case 'tan':
          stack.push(Math.tan((value * Math.PI) / 180));
          break;
        case 'sqrt':
          if (value < 0) {
            throw new Error('negative-sqrt');
          }
          stack.push(Math.sqrt(value));
          break;
        default:
          throw new Error('unknown-function');
      }
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      throw new Error('missing-operand');
    }

    switch (token) {
      case '+':
        stack.push(left + right);
        break;
      case '-':
        stack.push(left - right);
        break;
      case '*':
        stack.push(left * right);
        break;
      case '/':
        if (right === 0) {
          throw new Error('divide-by-zero');
        }
        stack.push(left / right);
        break;
      case '^':
        stack.push(left ** right);
        break;
      default:
        throw new Error('unknown-operator');
    }
  }

  if (stack.length !== 1) {
    throw new Error('invalid-expression');
  }

  return stack[0];
};

const tryEvaluateExpression = (expression: string) => {
  const tokens = tokenize(expression);
  const rpn = toRpn(tokens);
  const value = evaluateRpn(rpn);
  return trimTrailingZeros(value);
};

export const createCalculatorEngine = (options: CalculatorEngineOptions = {}) => {
  let orderSeed = options.history?.[0]?.order ?? 0;
  const state: CalculatorState = {
    mode: options.mode ?? 'basic',
    expression: options.expression ?? '',
    display: options.display ?? '0',
    status: options.status ?? 'value',
    history: options.history ? [...options.history] : [],
  };

  const syncDisplayFromExpression = () => {
    if (state.expression) {
      state.display = state.expression;
      state.status = 'value';
      return;
    }
    state.display = '0';
    state.status = 'value';
  };

  const replaceLastOperand = (transform: (operand: string) => string) => {
    const range = findLastOperandRange(state.expression);
    if (!range) {
      return false;
    }
    const operand = state.expression.slice(range.start, range.end);
    state.expression = `${state.expression.slice(0, range.start)}${transform(operand)}${state.expression.slice(range.end)}`;
    syncDisplayFromExpression();
    return true;
  };

  const evaluate = () => {
    if (!state.expression) {
      state.display = '0';
      state.status = 'value';
      return { status: state.status, display: state.display };
    }

    try {
      const result = tryEvaluateExpression(state.expression);
      state.display = result;
      state.status = 'value';
      orderSeed += 1;
      state.history = [
        {
          id: `history-${orderSeed}`,
          expression: state.expression,
          result,
          order: orderSeed,
        },
        ...state.history,
      ].slice(0, MAX_HISTORY);
      return { status: state.status, display: state.display };
    } catch {
      state.display = ERROR_MESSAGE;
      state.status = 'error';
      return { status: state.status, display: state.display };
    }
  };

  return {
    getState: () => ({
      ...state,
      history: [...state.history],
    }),
    setMode: (mode: CalculatorMode) => {
      state.mode = mode;
    },
    input: (token: string) => {
      const lastChar = state.expression[state.expression.length - 1];

      if (token === '+/-') {
        replaceLastOperand((operand) => `${operand}*-1`);
        return;
      }

      if (token === '%') {
        replaceLastOperand((operand) => `(${operand}/100)`);
        return;
      }

      if (state.status === 'error') {
        state.status = 'value';
        state.display = state.expression || '0';
      }

      if (token === 'pi' && isOperandEnd(lastChar)) {
        state.expression += '*';
      }

      if ((token === '(' || token === 'sqrt(' || token === 'sin(' || token === 'cos(' || token === 'tan(') && isOperandEnd(lastChar)) {
        state.expression += '*';
      }

      if (/^\d|\.$/.test(token) && state.expression === '0') {
        state.expression = '';
      }

      state.expression += token;
      syncDisplayFromExpression();
    },
    backspace: () => {
      if (!state.expression) {
        syncDisplayFromExpression();
        return;
      }
      state.expression = state.expression.slice(0, -1);
      syncDisplayFromExpression();
    },
    clear: () => {
      state.expression = '';
      syncDisplayFromExpression();
    },
    evaluate,
    recallHistoryResult: (id: string) => {
      const item = state.history.find((entry) => entry.id === id);
      if (!item) {
        return;
      }
      state.expression = item.result;
      state.display = item.result;
      state.status = 'value';
    },
  };
};
