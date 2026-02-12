import mongoose from "mongoose";

const generatedDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    resumeId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
    jobDescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: "JobDescription", required: true },
    type: { type: String, required: true, enum: ["resume", "cover_letter"] },
    content: {
      tailoredSummary: String,
      tailoredSkills: [{ name: String, keywords: [String] }],
      experienceWithRelevance: [
        {
          experienceId: mongoose.Schema.Types.ObjectId,
          bullets: [String],
          relevanceLine: String,
          matchedKsas: [String],
        },
      ],
      letterBody: String,
      greeting: String,
      closing: String,
    },
    exports: [
      {
        format: String,
        url: String,
        externalId: String,
        generatedAt: Date,
        expiresAt: Date,
      },
    ],
    templateId: mongoose.Schema.Types.ObjectId,
    templateSnapshot: mongoose.Schema.Types.Mixed,
    metadata: {
      aiModel: String,
      temperature: Number,
      tokenUsage: { input: Number, output: Number },
      processingTimeMs: Number,
      version: String,
    },
    matchAnalysis: {
      overallScore: Number,
      ksaMatches: [
        {
          ksa: String,
          matchType: String,
          confidence: Number,
          sourceEvidence: String,
        },
      ],
      missingRequirements: [String],
      suggestions: [String],
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

generatedDocumentSchema.index({ userId: 1 });
generatedDocumentSchema.index({ resumeId: 1 });
generatedDocumentSchema.index({ jobDescriptionId: 1 });
generatedDocumentSchema.index({ userId: 1, type: 1 });
generatedDocumentSchema.index({ userId: 1, createdAt: -1 });

export const GeneratedDocument = mongoose.model("GeneratedDocument", generatedDocumentSchema);
