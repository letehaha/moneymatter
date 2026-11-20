import cls from 'cls-hooked';
import { Sequelize } from 'sequelize-typescript';

export const namespace = cls.createNamespace('budget-tracker-namespace');
Sequelize.useCLS(namespace);

export const runOutsideTransaction = <T>(fn: () => Promise<T>): Promise<T> =>
  namespace.runPromise(() => {
    namespace.set('transaction', null);
    return fn();
  });

export const connection: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sequelize?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Sequelize?: any;
} = {};
