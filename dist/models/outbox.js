import mongoosePkg from "mongoose";  // default import
const { model, models, Schema } = mongoosePkg;

const OutboxSchema = new Schema({
  processid : {
   type : Number,
  },
  processing: {
    type: Boolean,
    required: true,
  },
  processed: {
    type: Boolean,
    required: true,
  },
  createdAt: {
    type: Number,
    required: true,
  },
  payload: {
    type: Object,
    required: true,
  },
  processedAt: {
    type: Number,
  },
  processingAt: {
    type: Number,
  },
});

// Ensure index for queries
OutboxSchema.index({ createdAt: 1, processedAt: 1, processingAt: 1 });

const Outbox = models.outbox || model("outbox", OutboxSchema);

export default Outbox;