import { Injectable } from '@nestjs/common';
import {
  MongoAbility,
  Subject as CaslSubject,
  createMongoAbility,
  MongoQuery,
  RawRuleOf,
} from '@casl/ability';

import { IUser as User } from 'src/interfaces/user.interface';
import { ILogin } from 'src/interfaces/login.interface';
import { Role } from 'src/common/enums/role.enum';
import { Action } from 'src/common/enums/action.enum';
import { Effect } from 'src/common/enums/effect.enum';

import { IPolicy } from 'src/interfaces/policy.interface';

export type Subject = User | 'User' | 'File' | 'Knowledge' | 'all';

import { get, isEmpty } from 'lodash';

export type Abilities<A extends string, S extends CaslSubject> = [A, S];
export type AppAbility<A extends string, S extends CaslSubject> = MongoAbility<
  Abilities<A, S>,
  MongoQuery
>;

interface IPermissions {
  subject: string;
  policies: IPolicy[];
}

@Injectable()
export class CaslAbilityFactory<
  A extends string = Action,
  S extends CaslSubject = Subject,
> {
  constructor() {}

  async defineAbility(
    permissions: IPermissions[],
    user: ILogin,
  ): Promise<AppAbility<A, S>> {
    const rules: RawRuleOf<AppAbility<A, S>>[] = [];

    // Administrators can do it all!
    if ([Role.Admin].some((role) => user.roles?.includes(role))) {
      rules.push({ action: Action.Manage, subject: 'all' } as RawRuleOf<
        AppAbility<A, S>
      >);
    }

    // Process all statements
    permissions.forEach((permission) => {
      permission.policies.forEach((policy) => {
        const fields = !isEmpty(policy.fields) ? policy.fields : undefined;
        const conditions = !isEmpty(policy.conditions)
          ? this.replacePlaceholders(policy.conditions, user)
          : undefined;

        const rule = {
          action: policy.actions,
          subject: permission.subject,
          fields,
          conditions,
        } as RawRuleOf<AppAbility<A, S>>;

        if (policy.effect === Effect.Allow) {
          rules.unshift(rule);
        } else if (policy.effect === Effect.Deny) {
          rule.inverted = true;
          // Place deny rules at the end
          rules.push(rule);
        }
      });
    });

    return createMongoAbility<AppAbility<A, S>>(rules);
  }

  /**
   * Recursively replaces placeholders in the conditions object with values from the user object.
   * @param conditions - The conditions object with placeholders.
   * @param values - The values object containing values to replace placeholders.
   * @returns The conditions object with placeholders replaced.
   */
  replacePlaceholders(
    conditions: Record<string, unknown>,
    values: object,
  ): Record<string, unknown> {
    // Traverse the conditions object
    for (const key in conditions) {
      const value = conditions[key];
      if (typeof value === 'object' && value !== null) {
        // Recursively replace placeholders in nested objects
        conditions[key] = this.replacePlaceholders(
          value as Record<string, unknown>,
          values,
        );
      } else if (typeof value === 'string') {
        // Replace the placeholder if it matches the {{}} pattern
        conditions[key] = this.replacePlaceholder(value, values);
      }
    }
    return conditions;
  }

  /**
   * Replaces a single placeholder with the corresponding value from the user object.
   * @param placeholder - The placeholder string.
   * @param values - The values object containing values to replace placeholders.
   * @returns The string with placeholders replaced.
   */
  private replacePlaceholder(placeholder: string, values: object): string {
    const regex = /\{\{([^{}]*)\}\}/g;
    return placeholder.replace(regex, (_, path: string) =>
      get(values, path.trim(), `{{${path}}}`),
    );
  }
}
