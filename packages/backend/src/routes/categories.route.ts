import createCategory from '@controllers/categories.controller/create-category';
import deleteCategory from '@controllers/categories.controller/delete-category';
import getCategories from '@controllers/categories.controller/get-categories';
import getCategoryTransactionCount from '@controllers/categories.controller/get-category-transaction-count';
import editCategory from '@controllers/categories.controller/update-category';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', getCategories);
router.post('/', checkBaseCurrencyLock, createCategory);
router.put('/:id', checkBaseCurrencyLock, editCategory);
router.delete('/:id', checkBaseCurrencyLock, deleteCategory);
router.get('/:id/transaction-count', getCategoryTransactionCount);

export default router;
