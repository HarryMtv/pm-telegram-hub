import { describe, expect, it } from 'vitest';

import { keyboardFor } from './callbacks.js';

type Btn = { text?: string; callback_data?: string; copy_text?: { text?: string } };
const buttons = (kb: { inline_keyboard: Btn[][] }): Btn[] => kb.inline_keyboard.flat();

describe('keyboardFor', () => {
  it('gives status events Take/Done/Comment buttons', () => {
    const kb = keyboardFor(
      { eventType: 'task.status_changed', provider: 'clickup', taskId: 't1' },
      'c1',
    );
    const datas = buttons(kb)
      .map((b) => b.callback_data)
      .filter((d): d is string => typeof d === 'string');
    expect(datas.some((d) => d.startsWith('take|'))).toBe(true);
    expect(datas.some((d) => d.startsWith('done|'))).toBe(true);
    expect(datas.some((d) => d.startsWith('comment|'))).toBe(true);
  });

  it('gives comment events Comment + Reply(callback), no Take/Done', () => {
    const kb = keyboardFor(
      {
        eventType: 'comment.added',
        provider: 'clickup',
        taskId: 't1',
        actor: 'Onboarding Assistant',
        actorId: '302663612',
      },
      'c1',
    );
    const datas = buttons(kb)
      .map((b) => b.callback_data)
      .filter((d): d is string => typeof d === 'string');
    expect(datas.some((d) => d.startsWith('comment|'))).toBe(true);
    expect(datas.some((d) => d.startsWith('reply|clickup|t1|302663612'))).toBe(true);
    expect(datas.some((d) => d.startsWith('take|') || d.startsWith('done|'))).toBe(false);
  });

  it('omits the Reply button when there is no author id', () => {
    const kb = keyboardFor(
      {
        eventType: 'comment.added',
        provider: 'clickup',
        taskId: 't1',
        actor: 'Onboarding Assistant',
      },
      'c1',
    );
    const hasReply = buttons(kb).some(
      (b) => typeof b.callback_data === 'string' && b.callback_data.startsWith('reply|'),
    );
    expect(hasReply).toBe(false);
  });
});
