const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Auditorium = require('../models/Auditorium');
const { protect, authorize } = require('../middleware/auth');
const { bookings: inMemoryBookings, auditoriums: inMemoryAuditoriums, users: inMemoryUsers } = require('../config/inMemoryDB');

// GET all bookings (admin/staff) or user's bookings
router.get('/', protect, async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      // MongoDB connected, use Mongoose
      let query = {};
      if (req.user.role === 'student' || req.user.role === 'faculty') {
        query.requestedBy = req.user._id;
      }
      const { status, auditorium, startDate, endDate } = req.query;
      if (status) query.status = status;
      if (auditorium) query.auditorium = auditorium;
      if (startDate || endDate) {
        query.startDateTime = {};
        if (startDate) query.startDateTime.$gte = new Date(startDate);
        if (endDate) query.startDateTime.$lte = new Date(endDate);
      }

      const bookings = await Booking.find(query)
        .populate('auditorium', 'name code location capacity')
        .populate('requestedBy', 'name email department role')
        .populate('approvedBy', 'name email')
        .sort({ createdAt: -1 });

      res.json({ success: true, count: bookings.length, data: bookings });
    } else {
      // Use in-memory data
      let filteredBookings = inMemoryBookings;
      if (req.user.role === 'student' || req.user.role === 'faculty') {
        filteredBookings = filteredBookings.filter(b => b.requestedBy === req.user._id);
      }
      const { status, auditorium, startDate, endDate } = req.query;
      if (status) filteredBookings = filteredBookings.filter(b => b.status === status);
      if (auditorium) filteredBookings = filteredBookings.filter(b => b.auditorium === auditorium);
      if (startDate || endDate) {
        filteredBookings = filteredBookings.filter(b => {
          const start = startDate ? new Date(startDate) : null;
          const end = endDate ? new Date(endDate) : null;
          const bStart = new Date(b.startDateTime);
          if (start && bStart < start) return false;
          if (end && bStart > end) return false;
          return true;
        });
      }

      // Simulate populate
      const populatedBookings = filteredBookings.map(b => {
        const booking = { ...b };
        booking.auditorium = inMemoryAuditoriums.find(a => a._id === b.auditorium) ? {
          _id: inMemoryAuditoriums.find(a => a._id === b.auditorium)._id,
          name: inMemoryAuditoriums.find(a => a._id === b.auditorium).name,
          code: inMemoryAuditoriums.find(a => a._id === b.auditorium).code,
          location: inMemoryAuditoriums.find(a => a._id === b.auditorium).location,
          capacity: inMemoryAuditoriums.find(a => a._id === b.auditorium).capacity
        } : null;
        booking.requestedBy = inMemoryUsers.find(u => u._id === b.requestedBy) ? {
          _id: inMemoryUsers.find(u => u._id === b.requestedBy)._id,
          name: inMemoryUsers.find(u => u._id === b.requestedBy).name,
          email: inMemoryUsers.find(u => u._id === b.requestedBy).email,
          department: inMemoryUsers.find(u => u._id === b.requestedBy).department,
          role: inMemoryUsers.find(u => u._id === b.requestedBy).role
        } : null;
        booking.approvedBy = b.approvedBy ? inMemoryUsers.find(u => u._id === b.approvedBy) ? {
          _id: inMemoryUsers.find(u => u._id === b.approvedBy)._id,
          name: inMemoryUsers.find(u => u._id === b.approvedBy).name,
          email: inMemoryUsers.find(u => u._id === b.approvedBy).email
        } : null : null;
        return booking;
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      res.json({ success: true, count: populatedBookings.length, data: populatedBookings });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single booking
router.get('/:id', protect, async (req, res) => {
  try {
    if (mongoose.connection.readyState === 1) {
      // MongoDB connected
      const booking = await Booking.findById(req.params.id)
        .populate('auditorium')
        .populate('requestedBy', 'name email department phone')
        .populate('approvedBy', 'name email');
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      if (req.user.role === 'student' && booking.requestedBy._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      res.json({ success: true, data: booking });
    } else {
      // In-memory
      const booking = inMemoryBookings.find(b => b._id === req.params.id);
      if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
      if (req.user.role === 'student' && booking.requestedBy !== req.user._id) {
        return res.status(403).json({ success: false, message: 'Not authorized' });
      }
      // Simulate populate
      const populatedBooking = { ...booking };
      populatedBooking.auditorium = inMemoryAuditoriums.find(a => a._id === booking.auditorium);
      populatedBooking.requestedBy = inMemoryUsers.find(u => u._id === booking.requestedBy) ? {
        _id: inMemoryUsers.find(u => u._id === booking.requestedBy)._id,
        name: inMemoryUsers.find(u => u._id === booking.requestedBy).name,
        email: inMemoryUsers.find(u => u._id === booking.requestedBy).email,
        department: inMemoryUsers.find(u => u._id === booking.requestedBy).department,
        phone: inMemoryUsers.find(u => u._id === booking.requestedBy).phone
      } : null;
      populatedBooking.approvedBy = booking.approvedBy ? inMemoryUsers.find(u => u._id === booking.approvedBy) ? {
        _id: inMemoryUsers.find(u => u._id === booking.approvedBy)._id,
        name: inMemoryUsers.find(u => u._id === booking.approvedBy).name,
        email: inMemoryUsers.find(u => u._id === booking.approvedBy).email
      } : null : null;
      res.json({ success: true, data: populatedBooking });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create booking
router.post('/', protect, async (req, res) => {
  try {
    const { auditorium, startDateTime, endDateTime, expectedAttendees } = req.body;

    // Check auditorium capacity
    const aud = await Auditorium.findById(auditorium);
    if (!aud) return res.status(404).json({ success: false, message: 'Auditorium not found' });
    if (expectedAttendees > aud.capacity) {
      return res.status(400).json({ success: false, message: `Expected attendees (${expectedAttendees}) exceeds capacity (${aud.capacity})` });
    }

    // Check for conflicts
    const conflict = await Booking.findOne({
      auditorium,
      status: { $in: ['approved', 'pending'] },
      $or: [
        { startDateTime: { $lt: new Date(endDateTime), $gte: new Date(startDateTime) } },
        { endDateTime: { $gt: new Date(startDateTime), $lte: new Date(endDateTime) } },
        { startDateTime: { $lte: new Date(startDateTime) }, endDateTime: { $gte: new Date(endDateTime) } }
      ]
    });
    if (conflict) {
      return res.status(409).json({ success: false, message: 'Auditorium already booked for this time slot', conflict });
    }

    const booking = await Booking.create({ ...req.body, requestedBy: req.user._id });
    const populated = await booking.populate(['auditorium', { path: 'requestedBy', select: 'name email' }]);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT update booking status (admin/staff)
router.put('/:id/status', protect, authorize('admin', 'staff'), async (req, res) => {
  try {
    const { status, rejectionReason, cancellationReason } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

    booking.status = status;
    if (status === 'approved') {
      booking.approvedBy = req.user._id;
      booking.approvedAt = new Date();
    }
    if (status === 'rejected') booking.rejectionReason = rejectionReason;
    if (status === 'cancelled') booking.cancellationReason = cancellationReason;
    await booking.save();

    const updated = await Booking.findById(booking._id)
      .populate('auditorium', 'name code')
      .populate('requestedBy', 'name email')
      .populate('approvedBy', 'name');

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT cancel booking (own booking)
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.requestedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.status = 'cancelled';
    booking.cancellationReason = req.body.reason || 'Cancelled by user';
    await booking.save();
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST feedback
router.post('/:id/feedback', protect, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (booking.requestedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    booking.feedback = { rating, comment, submittedAt: new Date() };
    await booking.save();
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
