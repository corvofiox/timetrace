const express = require('express');
const router = express.Router();
const {
  getGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  reorderGoals
} = require('../controllers/goals');
const { protect } = require('../middleware/auth');

router.route('/')
  .get(protect, getGoals)
  .post(protect, createGoal);

router.route('/reorder')
  .put(protect, reorderGoals);

router.route('/:id')
  .get(protect, getGoal)
  .put(protect, updateGoal)
  .delete(protect, deleteGoal);

module.exports = router;