import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, required: true },
    description: String,
    category: { type: String, default: "professional" },
    thumbnailUrl: String,
    previewUrl: String,
    templateType: { type: String, default: "reactive_resume", enum: ["reactive_resume", "custom_html"] },
    reactiveResumeJson: mongoose.Schema.Types.Mixed,
    htmlTemplate: String,
    cssStyles: String,
    options: {
      colorScheme: { primary: String, secondary: String, text: String, background: String },
      typography: { fontFamily: String, headerSize: Number, bodySize: Number },
      layout: { margins: mongoose.Schema.Types.Mixed, columns: Number, spacing: Number },
    },
    sectionOrder: [String],
    sidebarSections: [String],
    isPublic: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

templateSchema.index({ userId: 1 });
templateSchema.index({ isPublic: 1 });
templateSchema.index({ category: 1 });

export const Template = mongoose.model("Template", templateSchema);
