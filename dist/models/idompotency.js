import mongoosePkg from "mongoose";

const { model, models, Schema } = mongoosePkg;

const idomModel = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },

    jobId: {
      type: Schema.Types.ObjectId,
      ref: "jobs",
    },
  },
  {
    timestamps: true,
  }
);

const IdomModel =
  models["idompotency-key"] ||
  model("idompotency-key", idomModel);

export default IdomModel;