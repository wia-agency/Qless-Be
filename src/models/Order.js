const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Linked to a registered user (optional — guest orders won't have this)
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    customerName: { type: String, required: true, trim: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'preparing', 'ready', 'completed'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Virtual: compute queue position (how many pending/preparing orders were placed before this one)
orderSchema.methods.getQueuePosition = async function () {
  const count = await this.constructor.countDocuments({
    status: { $in: ['pending', 'preparing'] },
    createdAt: { $lt: this.createdAt },
  });
  return count + 1;
};

module.exports = mongoose.model('Order', orderSchema);
