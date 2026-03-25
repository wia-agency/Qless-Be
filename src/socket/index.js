const { Server } = require('socket.io');
const Order = require('../models/Order');

let io = null;

// Max timeTaken across an order's items (kitchen prepares items in parallel)
const orderPrepTime = (order) => {
  const times = order.items.map((i) => i.timeTaken || 0).filter((t) => t > 0);
  return times.length > 0 ? Math.max(...times) : 0;
};

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Mobile app subscribes to updates for a specific order
    socket.on('subscribe:order', ({ orderId }) => {
      if (orderId) {
        socket.join(`order:${orderId}`);
        console.log(`Socket ${socket.id} subscribed to order:${orderId}`);
      }
    });

    // Admin/kitchen panel joins the staff room to get all order updates
    socket.on('join:kitchen', () => {
      socket.join('kitchen');
      console.log(`Socket ${socket.id} joined kitchen room`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Broadcasts queue:update to all connected clients, now including estimatedWaitMinutes.
 *
 * estimatedWaitMinutes formula (same as getQueuePosition in Order model):
 *   - Each order's prep time = max(timeTaken) across its items
 *   - Estimated wait = sum of prep times for all orders at or before this position
 *   - Orders are already sorted oldest-first, so this is a running cumulative sum
 */
const emitQueueUpdate = async () => {
  if (!io) return;

  const activeOrders = await Order.find({
    status: { $in: ['pending', 'preparing'] },
  }).sort({ createdAt: 1 });

  // Build cumulative estimated wait times in one pass (O(n))
  let cumulativeMinutes = 0;

  const queueData = activeOrders.map((order, index) => {
    const prepTime = orderPrepTime(order);
    cumulativeMinutes += prepTime;

    return {
      orderId: order._id.toString(),
      status: order.status,
      customerName: order.customerName,
      queuePosition: index + 1,
      estimatedWaitMinutes: cumulativeMinutes,
    };
  });

  // Broadcast full queue to all clients (mobile app can find their entry by orderId)
  io.emit('queue:update', queueData);

  // Push order-specific position + wait time to each order's private room
  for (const entry of queueData) {
    io.to(`order:${entry.orderId}`).emit('queue:position', {
      orderId: entry.orderId,
      status: entry.status,
      queuePosition: entry.queuePosition,
      estimatedWaitMinutes: entry.estimatedWaitMinutes,
    });
  }

  // Full queue list for kitchen board
  io.to('kitchen').emit('kitchen:queue', queueData);
};

/**
 * Emits order:ready to the specific order's room.
 * Mobile app shows a "Your order is ready! Come pick it up." notification.
 */
const emitOrderReady = (orderId) => {
  if (!io) return;
  io.to(`order:${orderId}`).emit('order:ready', { orderId });
  emitQueueUpdate(); // triggers a fresh queue:update with updated positions
};

module.exports = { initSocket, emitQueueUpdate, emitOrderReady };
