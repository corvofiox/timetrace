const express = require('express');
const router = express.Router();
const {
  getDays,
  getDay,
  getDayByDate,
  createOrUpdateDay,
  updateDay,
  deleteDay,
  searchNotes
} = require('../controllers/days');
const { protect } = require('../middleware/auth');

router.route('/')
  .get(protect, getDays)
  .post(protect, createOrUpdateDay);

router.route('/search')
  .get(protect, searchNotes);

router.route('/date/:date')
  .get(protect, getDayByDate);

router.route('/:id')
  .get(protect, getDay)
  .put(protect, updateDay)
  .delete(protect, deleteDay);

module.exports = router;