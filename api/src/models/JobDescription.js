import mongoose from "mongoose";

const jobDescriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: String,
    company: String,
    location: String,
    url: String,
    source: String,
    rawText: String,
    extracted: {
      title: String,
      company: String,
      department: String,
      employmentType: String,
      experienceLevel: String,
      salaryRange: { min: Number, max: Number, currency: String },
      requirements: [String],
      preferredQualifications: [String],
      responsibilities: [String],
      benefits: [String],
    },
    ksas: [
      {
        term: String,
        category: String,
        importance: String,
        extracted: Boolean,
      },
    ],
    acronyms: [{ acronym: String, expansion: String }],
    notes: String,
    tags: [String],
    status: String,
    appliedAt: Date,
    processingStatus: { type: String, default: "pending" },
    processedAt: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

jobDescriptionSchema.index({ userId: 1 });
jobDescriptionSchema.index({ userId: 1, status: 1 });
jobDescriptionSchema.index({ userId: 1, company: 1 });
jobDescriptionSchema.index({ rawText: "text" });

export const JobDescription = mongoose.model("JobDescription", jobDescriptionSchema);
