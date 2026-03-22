import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import JobModel from "../../../dist/models/jobModel.js";
import { ratelimiter } from "../../../dist/lib/middleware_request.js";
import IdomModel from "../../../dist/models/idompotency.js";
import Outbox from "../../../dist/models/outbox.js";
import connectDB from "../../../dist/lib/mongodb.js";


export async function POST(req: NextRequest) {
  try {
    await connectDB();
  } catch (err) {
    return NextResponse.json(
      { status: 500, message: "Database is down" },
      { status: 500 }
    );
  }

  const body = await req.json();
  const idompotencykey = req.headers.get("idompotency-key");

  if (!idompotencykey) {
    return NextResponse.json(
      { message: "Idempotency key missing" },
      { status: 400 }
    );
  }

  // 🔹 Rate limiting
  const key = `bucket_${body.userid}`;
  const result = await ratelimiter({ key });

  if (!result.success) {
    return NextResponse.json(
      {
        message: `Call limit exceeded for user with id ${body.userid}`,
      },
      { status: 400 }
    );
  }

  const session = await mongoose.startSession();

  try {
    let createdJob: any;

    await session.withTransaction(async () => {
      // 🔹 Create Idempotency record
      const idom = new IdomModel({
        key: idompotencykey,
        paymentID: null,
      });

      await idom.save({ session });

      // 🔹 Create Job
      createdJob = new JobModel({
        jobType:
          body.type === null ? "email_generation" : body.type,
        status: "pending",
      });

      await createdJob.save({ session });

      // 🔹 Link job to idempotency key
      idom.paymentID = createdJob._id;
      
      await idom.save({ session });

      // 🔹 Outbox entry (IMPORTANT: inside transaction)
      await Outbox.create(
        [
          {
            processing: false,
            processed: false,
            createdAt: Date.now(),
            payload: {
              jobType : "email_generation",
              jobId: createdJob._id,
              status: createdJob.status,
              retry: 0,
            },
          },
        ],
        { session }
      );
    });
 

     

    return NextResponse.json(
      {
        status: 201,
        message: "Job created successfully",
      },
      { status: 201 }
    );
  } catch (err: any) {
    // 🔹 Handle duplicate idempotency key
    if (err.code === 11000) {
      const existing = await IdomModel.findOne({
        key: idompotencykey,
      }).lean();

      if (!existing?.paymentID) {
        return NextResponse.json(
          { message: "Duplicate request but no job found" },
          { status: 409 }
        );
      }

      const existingJob = await JobModel.findById(
        existing.paymentID
      ).lean();

      return NextResponse.json(
        {
          message: existingJob?.status ?? "Job already exists",
        },
        { status: 200 }
      );
    }

    console.error(err);

    return NextResponse.json(
      { message: "Something went wrong" },
      { status: 500 }
    );
  } finally {
    session.endSession();
  }
}