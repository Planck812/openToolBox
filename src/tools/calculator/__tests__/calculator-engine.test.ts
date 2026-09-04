import { describe, expect, it } from 'vitest';
import { createCalculatorEngine } from '../engine';

describe('calculator engine', () => {
  it('supports basic arithmetic, percent, sign toggle and parentheses', () => {
    const engine = createCalculatorEngine();

    engine.input('(');
    engine.input('5');
    engine.input('+');
    engine.input('5');
    engine.input(')');
    engine.input('%');
    engine.input('+/-');
    engine.input('+');
    engine.input('2');
    const evaluated = engine.evaluate();

    expect(evaluated.status).toBe('value');
    expect(evaluated.display).toBe('1.9');
    expect(engine.getState().history).toHaveLength(1);
    expect(engine.getState().history[0]).toMatchObject({
      expression: '((5+5)/100)*-1+2',
      result: '1.9',
    });
  });

  it('supports scientific functions in DEG mode', () => {
    const engine = createCalculatorEngine({ mode: 'scientific' });

    engine.input('sin(');
    engine.input('3');
    engine.input('0');
    engine.input(')');
    engine.input('+');
    engine.input('sqrt(');
    engine.input('9');
    engine.input(')');
    engine.input('+');
    engine.input('pi');
    const evaluated = engine.evaluate();

    expect(evaluated.status).toBe('value');
    expect(evaluated.display).toBe('6.641593');
  });

  it('returns error state for invalid expressions and keeps the expression', () => {
    const engine = createCalculatorEngine();

    engine.input('(');
    engine.input('1');
    engine.input('+');
    engine.input('2');
    const evaluated = engine.evaluate();

    expect(evaluated.status).toBe('error');
    expect(evaluated.display).toBe('tools.calculator.error_message');
    expect(engine.getState().expression).toBe('(1+2');
    expect(engine.getState().history).toHaveLength(0);
  });

  it('keeps only the latest ten history records and recalls only the result', () => {
    const engine = createCalculatorEngine();

    for (let i = 1; i <= 11; i += 1) {
      engine.clear();
      engine.input(String(i));
      engine.input('+');
      engine.input('1');
      engine.evaluate();
    }

    const state = engine.getState();
    expect(state.history).toHaveLength(10);
    expect(state.history[0]).toMatchObject({ expression: '11+1', result: '12' });
    expect(state.history[9]).toMatchObject({ expression: '2+1', result: '3' });

    engine.recallHistoryResult(state.history[3].id);
    expect(engine.getState().expression).toBe(state.history[3].result);
    expect(engine.getState().display).toBe(state.history[3].result);
  });
});
