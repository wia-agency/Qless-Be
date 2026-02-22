const { Server } = require('socket.io');
const Order = require('../models/Order');

let io = null;

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
 * Broadcasts queue:update to all connected clients.
 * Each client receives the full active queue so they can recompute their position.
 */
const emitQueueUpdate = async () => {
  if (!io) return;

  const activeOrders = await Order.find({
    status: { $in: ['pending', 'preparing'] },
  }).sort({ createdAt: 1 });

  // Build queue map: orderId → position (1-indexed)
  const queueData = activeOrders.map((order, index) => ({
    orderId: order._id.toString(),
    status: order.status,
    customerName: order.customerName,
    queuePosition: index + 1,
  }));

  // Emit to everyone
  io.emit('queue:update', queueData);

  // Also emit to each order's room with that order's specific position
  for (const entry of queueData) {
    io.to(`order:${entry.orderId}`).emit('queue:position', {
      orderId: entry.orderId,
      status: entry.status,
      queuePosition: entry.queuePosition,
    });
  }

  // Notify kitchen room with full order list
  io.to('kitchen').emit('kitchen:queue', queueData);
};

/**
 * Emits order:ready to the specific order's room.
 * Mobile app can show a "Your order is ready! Come pick it up." notification.
 */
const emitOrderReady = (orderId) => {
  if (!io) return;
  io.to(`order:${orderId}`).emit('order:ready', { orderId });
  io.emit('queue:update', []); // trigger refresh
};

module.exports = { initSocket, emitQueueUpdate, emitOrderReady };
