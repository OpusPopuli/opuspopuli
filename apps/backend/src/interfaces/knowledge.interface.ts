import { Effect } from '../common/enums/effect.enum';
import { IPolicy } from './policy.interface';
import { Action } from '../common/enums/action.enum';

export const IKnowledgePolicies: IPolicy[] = [
  {
    effect: Effect.Allow,
    actions: [Action.Create, Action.Read],
    subjects: ['Knowledge'],
    fields: [],
    conditions: {
      userId: '{{id}}',
    },
  },
];
