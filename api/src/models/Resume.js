import mongoose from "mongoose";

const resumeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
    contact: {
      fullName: String,
      email: String,
      phone: String,
      location: { city: String, state: String, country: String, address: String },
      linkedin: String,
      website: String,
      github: String,
      portfolio: String,
    },
    summary: { content: String, keywords: [String] },
    skills: [
      {
        category: String,
        name: String,
        items: [String],
        proficiency: String,
        yearsOfExperience: Number,
      },
    ],
    experience: [
      {
        employer: String,
        title: String,
        location: String,
        startDate: Date,
        endDate: Date,
        isCurrent: Boolean,
        description: String,
        bullets: [String],
        achievements: [String],
        technologies: [String],
        keywords: [String],
      },
    ],
    education: [
      {
        institution: String,
        degree: String,
        field: String,
        location: String,
        startDate: Date,
        endDate: Date,
        gpa: String,
        honors: [String],
        coursework: [String],
        activities: [String],
      },
    ],
    certifications: [
      { name: String, issuer: String, dateObtained: Date, expirationDate: Date, credentialId: String, url: String },
    ],
    awards: [{ title: String, issuer: String, date: Date, description: String }],
    projects: [
      { name: String, role: String, description: String, technologies: [String], url: String, startDate: Date, endDate: Date },
    ],
    publications: [{ title: String, publisher: String, date: Date, url: String, description: String }],
    languages: [{ language: String, proficiency: String }],
    volunteering: [{ organization: String, role: String, description: String, startDate: Date, endDate: Date }],
    references: [
      { name: String, title: String, company: String, relationship: String, email: String, phone: String },
    ],
    sectionSettings: {
      includeProjects: Boolean,
      includePublications: Boolean,
      includeVolunteering: Boolean,
      includeLanguages: Boolean,
      includeReferences: Boolean,
      includeCertifications: Boolean,
      includeAwards: Boolean,
    },
    metadata: { version: Number, lastTailoredFor: mongoose.Schema.Types.ObjectId, generationCount: Number },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

resumeSchema.index({ userId: 1, isDefault: 1 });
resumeSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Resume = mongoose.model("Resume", resumeSchema);
