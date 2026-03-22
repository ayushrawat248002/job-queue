import mongoosePkg from "mongoose";  // default import
const { model, models, Schema } = mongoosePkg;

const jobSchema = new Schema({
  jobType: {
    type: String,
    required: [true, "jobType is required"],
  },
  status: {
    type: String,
    enum: {
      values: ["pending", "processing", "complete", "failed"],
      message: "status should be either pending, processing, complete, failed",
    },
  },
  startedAt : {
    type : Number,
    required : false
  },
  workerId : {
    type : Number,
    required : false
  }
}, {
  timestamps: true,
});

const jobModel = models.jobs || model("jobs", jobSchema);

export default jobModel;