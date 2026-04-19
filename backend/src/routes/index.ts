import { Router } from 'express';
import healthRouter from './health';
import authRouter from './auth';
import stagesRouter from './stages';
import cardsRouter from './cards';
import dashboardRouter from './dashboard';
import remindersRouter from './reminders';
import todosRouter from './todos';
import autocompleteRouter from './autocomplete';
import eventsRouter from './events';

const router = Router();

// Health and metrics (mounted at /api)
router.use('/', healthRouter);

// Auth routes
router.use('/auth', authRouter);

// Resource routes
router.use('/stages', stagesRouter);
router.use('/cards', cardsRouter);
router.use('/dashboard', dashboardRouter);
router.use('/reminders', remindersRouter);
router.use('/todos', todosRouter);
router.use('/autocomplete', autocompleteRouter);
router.use('/events', eventsRouter);

export default router;
