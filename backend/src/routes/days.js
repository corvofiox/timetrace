const express = require('express');
const router = express.Router();
const {
  getDays,
  getDay,
  getDayByDate,
  createOrUpdateDay,
  updateDay,
  deleteDay
} = require('../controllers/days');
const { protect } = require('../middleware/auth');

router.route('/')
  .get(protect, getDays)
  .post(protect, createOrUpdateDay);

router.route('/:id')
  .get(protect, getDay)
  .put(protect, updateDay)
  .delete(protect, deleteDay);

router.route('/date/:date')
  .get(protect, getDayByDate);

module.exports = router;