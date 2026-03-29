const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
    // Snapshot prep time at order time so estimates don't change if menu is updated later
    timeTaken: { type: Number, default: null },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    customerName: { type: String, required: true, trim: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'completed', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Returns how long one order takes: max timeTaken across its items (kitchen prepares in parallel)
const orderPrepTime = (order) => {
  const times = order.items.map((i) => i.timeTaken || 0).filter((t) => t > 0);
  return times.length > 0 ? Math.max(...times) : 0;
};

/**
 * Returns { position, estimatedMinutes }
 * position       — how many active orders are ahead (1 = next up)
 * estimatedMinutes — sum of prep times of all orders ahead + this order's own prep time
 */
orderSchema.methods.getQueuePosition = async function () {
  const ordersAhead = await this.constructor.find({
    status: { $in: ['pending', 'preparing'] },
    createdAt: { $lt: this.createdAt },
  });

  const position = ordersAhead.length + 1;
  const waitFromAhead = ordersAhead.reduce((sum, o) => sum + orderPrepTime(o), 0);
  const estimatedMinutes = waitFromAhead + orderPrepTime(this);

  return { position, estimatedMinutes };
};

module.exports = mongoose.model('Order', orderSchema);
