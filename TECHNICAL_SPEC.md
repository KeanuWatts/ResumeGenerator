# Resume Generator REST API - Technical Specification

## Executive Summary

This document outlines the migration of the Google Sheets-based Resume Generator to a Node.js REST API service with MongoDB backend. The system will support multi-user, multi-job description setups where any authenticated user can generate tailored resumes and cover letters for any job description in their account.

---

## Table of Contents

1. [Current System Analysis](#1-current-system-analysis)
2. [Target Architecture](#2-target-architecture)
3. [MongoDB Data Models](#3-mongodb-data-models)
4. [API Structure](#4-api-structure)
5. [Core Services](#5-core-services)
6. [Data Flow](#6-data-flow)
7. [External Integrations](#7-external-integrations)
8. [Security Considerations](#8-security-considerations)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Frontend (Web UI)](#10-frontend-web-ui)
11. [Development Environment](#11-development-environment)
12. [Kubernetes Deployment](#12-kubernetes-deployment)

---

## 1. Current System Analysis

### 1.1 Existing Functions

| Function | File | Purpose |
|----------|------|---------|
| `extractFields_FromB2()` | ExtractJobReport.gs | Extracts title, company, KSAs, and acronyms from job description text using DeepSeek AI |
| `Generate_Resume_Doc_From_Segments()` | GenerateResume.gs | Generates tailored Google Doc resume from spreadsheet data |
| `generateOrUpdateCoverLetter()` | GenerateCV.gs.ts | Creates cover letters using resume text and job context |
| `Generate_ReactiveResume_PDF_From_Doc()` | GenerateHTML.gs.ts | Converts resume to Reactive Resume JSON and exports PDF |

### 1.2 Current Data Sources (Spreadsheet Cells)

```
Sheet Layout:
├── B2:  Job Description (input text)
├── B3:  Position Title (extracted/output)
├── B4:  Company Name (extracted/output)
├── B5:  KSAs - Knowledge, Skills, Abilities (extracted)
├── B6:  Acronyms (extracted)
├── B7:  Resume Google Doc URL (output)
├── B8:  Cover Letter Google Doc URL (output)
├── B9:  Candidate Full Name
├── B39: Reactive Resume Base URL
├── B40: Template JSON
├── C7:  Generated PDF URL (output)
└── Rows 13+: Resume sections (Contact, Summary, Skills, Employment, Education, etc.)
```

### 1.3 Resume Sections Supported

1. **Contact Information** - City, State, Phone, Email, LinkedIn, Website
2. **Summary** - Professional summary (AI-tailored per job)
3. **Skills** - Technical and soft skills (scored and prioritized)
4. **Employment/Experience** - Job history with bullet points
5. **Education** - Degrees, institutions, dates
6. **Certifications** - Professional certifications
7. **Awards** - Recognition and achievements
8. **Publications** - Academic/professional publications
9. **Projects** - Notable projects
10. **Volunteering** - Community involvement
11. **Languages** - Language proficiencies
12. **References** - Professional references

### 1.4 AI Processing Features

- **Summary Rewriting**: Context-aware AI rewrite matching job requirements
- **KSA Extraction**: Identifies knowledge, skills, abilities from job descriptions
- **KSA Matching**: Semantic matching of candidate KSAs to job requirements
- **Skill Prioritization**: Ranks skills by relevance to target job
- **Bullet Enhancement**: Enhances experience bullets with matched KSAs
- **Cover Letter Generation**: AI-generated cover letter body

---

## 2. Target Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     WEB UI (React + Next.js)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    NODE.JS REST API (Stateless)                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  In-app: Rate limiting (configurable) │ Auth (JWT + refresh)     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Auth      │  │   Resume    │  │   Job       │  │   Export    │     │
│  │   Module    │  │   Module    │  │   Module    │  │   Module    │     │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   AI        │  │   Template  │  │   Cover     │  │   User      │     │
│  │   Service   │  │   Service   │  │   Letter    │  │   Service   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│    MongoDB      │  │   DeepSeek AI   │  │ Reactive Resume  │
│    Database     │  │   (external)    │  │ (self-hosted)    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐  ┌─────────────────┐
│   RabbitMQ      │  │  S3-compatible  │
│   (async jobs)  │  │  (PDF storage) │
└─────────────────┘  └─────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ (LTS) |
| Framework | Express.js or Fastify |
| Database | MongoDB 7.0+ |
| ODM | Mongoose |
| Authentication | JWT + Refresh Tokens |
| Validation | Zod or Joi |
| AI Integration | DeepSeek API |
| PDF Generation | Reactive Resume (self-hosted) |
| File Storage | S3-compatible (AWS S3 or local MinIO/LocalStack) |
| Queue | RabbitMQ |

---

## 3. MongoDB Data Models

### 3.1 User Collection

```javascript
// Collection: users
{
  _id: ObjectId,
  email: String,                    // Unique, indexed
  passwordHash: String,             // bcrypt hashed
  profile: {
    fullName: String,               // Required
    phone: String,
    location: {
      city: String,
      state: String,
      country: String
    },
    linkedin: String,
    website: String,
    headline: String                // Professional headline
  },
  settings: {
    defaultTemplateId: ObjectId,    // Reference to templates
    aiPreferences: {
      temperature: Number,          // 0.1 - 1.0
      model: String                 // "deepseek-chat"
    },
    exportFormat: String            // "pdf" | "json"
  },
  subscription: {
    tier: String,                   // "free" | "pro" | "enterprise"
    expiresAt: Date,
    features: [String]
  },
  apiKeys: {
    deepseek: String,               // Encrypted
    reactiveResume: String          // Encrypted
  },
  createdAt: Date,
  updatedAt: Date,
  lastLoginAt: Date
}

// Indexes:
// - email: unique
// - createdAt: 1
```

### 3.2 Resume Collection (Master Resume Data)

```javascript
// Collection: resumes
{
  _id: ObjectId,
  userId: ObjectId,                 // Reference to users, indexed
  name: String,                     // "Master Resume", "Tech Resume", etc.
  isDefault: Boolean,               // One default per user
  
  // Contact Information
  contact: {
    fullName: String,
    email: String,
    phone: String,
    location: {
      city: String,
      state: String,
      country: String,
      address: String               // Optional full address
    },
    linkedin: String,
    website: String,
    github: String,
    portfolio: String
  },
  
  // Professional Summary (base version)
  summary: {
    content: String,                // Base summary text
    keywords: [String]              // Key terms for matching
  },
  
  // Skills
  skills: [{
    _id: ObjectId,
    category: String,               // "Programming", "Tools", "Soft Skills"
    name: String,                   // Skill category name
    items: [String],                // Individual skills
    proficiency: String,            // "beginner" | "intermediate" | "advanced" | "expert"
    yearsOfExperience: Number
  }],
  
  // Employment History
  experience: [{
    _id: ObjectId,
    employer: String,
    title: String,
    location: String,
    startDate: Date,
    endDate: Date,                  // null = current
    isCurrent: Boolean,
    description: String,            // Full description text
    bullets: [String],              // Individual bullet points
    achievements: [String],         // Quantifiable achievements
    technologies: [String],         // Tech used in role
    keywords: [String]              // For AI matching
  }],
  
  // Education
  education: [{
    _id: ObjectId,
    institution: String,
    degree: String,                 // "Bachelor of Science"
    field: String,                  // "Computer Science"
    location: String,
    startDate: Date,
    endDate: Date,
    gpa: String,
    honors: [String],
    coursework: [String],
    activities: [String]
  }],
  
  // Certifications
  certifications: [{
    _id: ObjectId,
    name: String,
    issuer: String,
    dateObtained: Date,
    expirationDate: Date,
    credentialId: String,
    url: String
  }],
  
  // Awards
  awards: [{
    _id: ObjectId,
    title: String,
    issuer: String,
    date: Date,
    description: String
  }],
  
  // Projects
  projects: [{
    _id: ObjectId,
    name: String,
    role: String,
    description: String,
    technologies: [String],
    url: String,
    startDate: Date,
    endDate: Date
  }],
  
  // Publications
  publications: [{
    _id: ObjectId,
    title: String,
    publisher: String,
    date: Date,
    url: String,
    description: String
  }],
  
  // Languages
  languages: [{
    _id: ObjectId,
    language: String,
    proficiency: String             // "native" | "fluent" | "professional" | "conversational" | "basic"
  }],
  
  // Volunteering
  volunteering: [{
    _id: ObjectId,
    organization: String,
    role: String,
    description: String,
    startDate: Date,
    endDate: Date
  }],
  
  // References
  references: [{
    _id: ObjectId,
    name: String,
    title: String,
    company: String,
    relationship: String,
    email: String,
    phone: String
  }],
  
  // Section visibility toggles
  sectionSettings: {
    includeProjects: Boolean,
    includePublications: Boolean,
    includeVolunteering: Boolean,
    includeLanguages: Boolean,
    includeReferences: Boolean,     // false = "Available upon request"
    includeCertifications: Boolean,
    includeAwards: Boolean
  },
  
  // Metadata
  metadata: {
    version: Number,
    lastTailoredFor: ObjectId,      // Last job description ID
    generationCount: Number
  },
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - userId: 1
// - userId + isDefault: compound
// - userId + name: compound unique
```

### 3.3 Job Descriptions Collection

```javascript
// Collection: jobDescriptions
{
  _id: ObjectId,
  userId: ObjectId,                 // Owner, indexed
  
  // Basic Info
  title: String,                    // Job title
  company: String,                  // Company name
  location: String,                 // Job location
  url: String,                      // Original job posting URL
  source: String,                   // "linkedin" | "indeed" | "manual" | etc.
  
  // Full Description
  rawText: String,                  // Original job description text
  
  // AI-Extracted Fields
  extracted: {
    title: String,                  // AI-extracted title
    company: String,                // AI-extracted company
    department: String,
    employmentType: String,         // "full-time" | "part-time" | "contract"
    experienceLevel: String,        // "entry" | "mid" | "senior" | "lead"
    salaryRange: {
      min: Number,
      max: Number,
      currency: String
    },
    requirements: [String],         // Required qualifications
    preferredQualifications: [String],
    responsibilities: [String],
    benefits: [String]
  },
  
  // KSAs (Knowledge, Skills, Abilities)
  ksas: [{
    term: String,
    category: String,               // "systems" | "processes" | "technologies" | "certifications" | "domain"
    importance: String,             // "required" | "preferred" | "nice-to-have"
    extracted: Boolean              // AI-extracted vs manual
  }],
  
  // Acronyms found in job description
  acronyms: [{
    acronym: String,                // "API"
    expansion: String               // "Application Programming Interface"
  }],
  
  // User-added notes and tags
  notes: String,
  tags: [String],                   // User-defined tags for organization
  
  // Application Status
  status: String,                   // "saved" | "applied" | "interviewing" | "rejected" | "offer"
  appliedAt: Date,
  
  // Processing Status
  processingStatus: String,         // "pending" | "processing" | "completed" | "failed"
  processedAt: Date,
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - userId: 1
// - userId + status: compound
// - userId + tags: compound
// - userId + company: compound
// - rawText: text index (for search)
```

### 3.4 Generated Documents Collection

```javascript
// Collection: generatedDocuments
{
  _id: ObjectId,
  userId: ObjectId,                 // Owner, indexed
  resumeId: ObjectId,               // Source resume, indexed
  jobDescriptionId: ObjectId,       // Target job, indexed
  
  type: String,                     // "resume" | "cover_letter"
  
  // Generated Content
  content: {
    // For resumes:
    tailoredSummary: String,
    tailoredSkills: [{
      name: String,
      keywords: [String]
    }],
    experienceWithRelevance: [{
      experienceId: ObjectId,       // Reference to source experience
      bullets: [String],            // Possibly enhanced bullets
      relevanceLine: String,        // AI-generated relevance statement
      matchedKsas: [String]
    }],
    
    // For cover letters:
    letterBody: String,
    greeting: String,
    closing: String
  },
  
  // Export Information (PDF only)
  exports: [{
    format: String,                 // "pdf"
    url: String,                    // Storage URL (signed)
    externalId: String,             // Reactive Resume resume ID
    generatedAt: Date,
    expiresAt: Date                 // For temporary URLs
  }],
  
  // Template Used
  templateId: ObjectId,             // Reference to templates collection
  templateSnapshot: Object,         // Snapshot of template at generation time
  
  // Generation Metadata
  metadata: {
    aiModel: String,
    temperature: Number,
    tokenUsage: {
      input: Number,
      output: Number
    },
    processingTimeMs: Number,
    version: String                 // API version used
  },
  
  // Match Analysis
  matchAnalysis: {
    overallScore: Number,           // 0-100
    ksaMatches: [{
      ksa: String,
      matchType: String,            // "exact" | "token" | "similar"
      confidence: Number,
      sourceEvidence: String        // Where in resume this was found
    }],
    missingRequirements: [String],
    suggestions: [String]
  },
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - userId: 1
// - resumeId: 1
// - jobDescriptionId: 1
// - userId + type: compound
// - userId + createdAt: compound (for listing recent)
```

### 3.5 Templates Collection

```javascript
// Collection: templates
{
  _id: ObjectId,
  userId: ObjectId,                 // null = system template, ObjectId = user custom
  
  name: String,                     // "Modern", "Classic", "Minimal"
  description: String,
  category: String,                 // "professional" | "creative" | "academic" | "technical"
  
  // Preview
  thumbnailUrl: String,
  previewUrl: String,
  
  // Template Type
  templateType: String,             // "reactive_resume" | "custom_html"
  
  // For Reactive Resume templates
  reactiveResumeJson: Object,       // Full RR template JSON
  
  // For custom templates
  htmlTemplate: String,
  cssStyles: String,
  
  // Customization Options
  options: {
    colorScheme: {
      primary: String,
      secondary: String,
      text: String,
      background: String
    },
    typography: {
      fontFamily: String,
      headerSize: Number,
      bodySize: Number
    },
    layout: {
      margins: Object,
      columns: Number,
      spacing: Number
    }
  },
  
  // Section Configuration
  sectionOrder: [String],           // ["summary", "experience", "education", ...]
  sidebarSections: [String],        // Sections to place in sidebar
  
  // Visibility
  isPublic: Boolean,                // Available to all users
  isDefault: Boolean,               // System default template
  
  createdAt: Date,
  updatedAt: Date
}

// Indexes:
// - userId: 1
// - isPublic: 1
// - category: 1
```

### 3.6 Audit Log Collection

```javascript
// Collection: auditLogs
{
  _id: ObjectId,
  userId: ObjectId,
  action: String,                   // "resume.generate" | "job.extract" | "export.pdf"
  resourceType: String,             // "resume" | "jobDescription" | "generatedDocument"
  resourceId: ObjectId,
  details: Object,                  // Action-specific details
  ipAddress: String,
  userAgent: String,
  createdAt: Date
}

// Indexes:
// - userId + createdAt: compound
// - action: 1
// - TTL index on createdAt (auto-delete after 90 days)
```

---

## 4. API Structure

### 4.1 Base URL Structure

```
Production:  https://api.resumegen.theclusterflux.com/v1
Staging:     https://api-staging.resumegen.theclusterflux.com/v1
Local:       http://localhost:4000/v1  (API when using docker-compose)
```

**Conventions:** List endpoints (`GET /resumes`, `GET /jobs`, `GET /documents`) support pagination via query parameters (e.g. `limit`, `offset` or `cursor`). API version prefix is `/v1`.

### 4.2 Health Endpoints

```
GET    /health                   - Liveness (API process is up)
GET    /ready                    - Readiness (DB, RabbitMQ, optional deps reachable)
```

Used by Kubernetes and load balancers. `GET /ready` should fail if the API cannot serve traffic (e.g. MongoDB or RabbitMQ unreachable).

### 4.3 Authentication Endpoints

```
POST   /auth/register              - Create new user account
POST   /auth/login                 - Authenticate and get tokens
POST   /auth/refresh               - Refresh access token
POST   /auth/logout                - Invalidate refresh token
POST   /auth/forgot-password       - Request password reset
POST   /auth/reset-password        - Reset password with token
GET    /auth/me                    - Get current user info
```

### 4.4 User Endpoints

```
GET    /users/profile              - Get user profile
PATCH  /users/profile              - Update user profile
PUT    /users/settings             - Update user settings
PUT    /users/api-keys             - Update API keys (encrypted)
DELETE /users/account              - Delete user account
```

### 4.5 Resume Endpoints

```
# Master Resume CRUD
GET    /resumes                    - List all user's resumes
POST   /resumes                    - Create new master resume
GET    /resumes/:id                - Get specific resume
PUT    /resumes/:id                - Update entire resume
PATCH  /resumes/:id                - Partial update
DELETE /resumes/:id                - Delete resume

# Resume Sections (granular updates)
GET    /resumes/:id/experience     - Get experience section
POST   /resumes/:id/experience     - Add experience entry
PUT    /resumes/:id/experience/:expId    - Update experience entry
DELETE /resumes/:id/experience/:expId    - Delete experience entry

# Similar pattern for other sections:
# /resumes/:id/education, /resumes/:id/skills, etc.

# Import/Export
POST   /resumes/import             - Import from JSON/LinkedIn/etc.
GET    /resumes/:id/export         - Export resume as JSON
```

### 4.6 Job Description Endpoints

```
# Job Description CRUD
GET    /jobs                       - List all job descriptions
POST   /jobs                       - Create/save job description
GET    /jobs/:id                   - Get specific job description
PUT    /jobs/:id                   - Update job description
DELETE /jobs/:id                   - Delete job description

# AI Processing
POST   /jobs/:id/extract           - Extract fields from job text using AI
POST   /jobs/extract               - Extract without saving (preview)

# Bulk Operations
POST   /jobs/bulk-import           - Import multiple jobs
DELETE /jobs/bulk                  - Delete multiple jobs

# Search and Filter
GET    /jobs/search                - Search jobs (full-text)
GET    /jobs/tags                  - Get all user's tags
```

### 4.7 Generation Endpoints

**Idempotency:** For `POST /generate/resume`, `POST /generate/cover-letter`, and `POST /export/pdf`, clients may send an `Idempotency-Key` header (opaque string, e.g. UUID). If the same key is sent again within the retention window, the API returns the same result without re-running the operation. Retention: 24 hours.

```
# Resume Generation
POST   /generate/resume            - Generate tailored resume
       Header: Idempotency-Key (optional)
       Body: { resumeId, jobDescriptionId, templateId?, options? }
       
POST   /generate/resume/preview    - Preview without saving
       Body: { resumeId, jobDescriptionId }

# Cover Letter Generation  
POST   /generate/cover-letter      - Generate cover letter
       Header: Idempotency-Key (optional)
       Body: { resumeId, jobDescriptionId, options? }
       
POST   /generate/cover-letter/preview - Preview without saving

# Match Analysis
POST   /generate/match-analysis    - Analyze resume-job match
       Body: { resumeId, jobDescriptionId }
       Response: { score, matches, gaps, suggestions }

# AI Enhancements
POST   /generate/enhance-bullets   - Enhance experience bullets
       Body: { bullets[], jobContext }
       
POST   /generate/tailor-summary    - Generate tailored summary
       Body: { baseSummary, jobDescriptionId }
```

### 4.8 Export Endpoints

**Export format:** PDF only. All exports are produced via the self-hosted Reactive Resume API and stored in S3-compatible storage.

**Idempotency:** `POST /export/pdf` supports the `Idempotency-Key` header; duplicate keys return the same export URL without regenerating.

```
# Document Export (PDF only)
POST   /export/pdf                 - Export as PDF (via self-hosted Reactive Resume)
       Header: Idempotency-Key (optional)
       Body: { generatedDocumentId, templateId? }
       Response: { url, expiresAt }

# Generated Documents
GET    /documents                  - List generated documents (paginated)
GET    /documents/:id              - Get specific generated document
DELETE /documents/:id              - Delete generated document
```

### 4.9 Template Endpoints

```
GET    /templates                  - List available templates
GET    /templates/:id              - Get template details
POST   /templates                  - Create custom template
PUT    /templates/:id              - Update custom template
DELETE /templates/:id              - Delete custom template

# Template Preview
POST   /templates/:id/preview      - Preview template with sample data
```

### 4.10 Webhooks (outgoing, optional)

When generation or export is processed asynchronously (via RabbitMQ), the API can notify a user-configured webhook URL. Clients register a URL in user settings; the API sends a signed payload (e.g. HMAC) when the job completes. Retries with backoff on failure. Not required for polling-based flows.

---

## 5. Core Services

### 5.1 AI Service

```javascript
// services/ai.service.js

class AIService {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.endpoint = 'https://api.deepseek.com/v1/chat/completions';
    this.model = options.model || 'deepseek-chat';
    this.defaultTemperature = options.temperature || 0.3;
  }

  /**
   * Extract job fields from description text
   * Maps to: extractFields_FromB2() in ExtractJobReport.gs
   */
  async extractJobFields(jobText) {
    // Returns: { title, company, ksas[], acronyms[] }
  }

  /**
   * Generate tailored summary
   * Maps to: aiSummaryRewrite_() in GenerateResume.gs
   */
  async tailorSummary(baseSummary, jobDescription, resumeContext, options) {
    // Returns: tailored summary string
  }

  /**
   * Generate cover letter body
   * Maps to: callDeepSeek_CoverLetterBody_() in GenerateCV.gs.ts
   */
  async generateCoverLetterBody(resumeText, jobContext) {
    // Returns: cover letter body paragraphs
  }

  /**
   * Check KSA similarity (semantic matching)
   * Maps to: checkKsaSimilarity_() in GenerateResume.gs
   */
  async checkKsaSimilarity(originalKsa, jobRequirement) {
    // Returns: { similar: boolean, confidence: number, explanation: string }
  }

  /**
   * Extract Reactive Resume JSON sections
   * Maps to: dsJsonOnly_() calls in GenerateHTML.gs.ts
   */
  async extractResumeSection(sectionName, resumeText, templateFragment) {
    // Returns: JSON object for section
  }
}
```

### 5.2 Resume Generation Service

```javascript
// services/resume-generation.service.js

class ResumeGenerationService {
  /**
   * Generate a fully tailored resume
   * Maps to: Generate_Resume_Doc_From_Segments() in GenerateResume.gs
   */
  async generateTailoredResume(resumeId, jobDescriptionId, options) {
    // 1. Load master resume
    // 2. Load job description with extracted KSAs
    // 3. Extract and match KSAs
    // 4. Tailor summary
    // 5. Prioritize and tailor skills
    // 6. Generate relevance lines for experience
    // 7. Enhance bullets with matched KSAs
    // 8. Return structured result
  }

  /**
   * Match KSAs to job description
   * Maps to: matchKsasToJobDescription_() in GenerateResume.gs
   */
  async matchKsasToJob(ksaTerms, jobDescription, existingKsas) {
    // Returns: matched KSAs with confidence scores
  }

  /**
   * Enhance experience bullets with KSAs
   * Maps to: enhanceBulletsWithKsas_() in GenerateResume.gs
   */
  async enhanceBullets(bullets, matchedKsas, jobDescription) {
    // Returns: enhanced bullets array
  }
}
```

### 5.3 Export Service

```javascript
// services/export.service.js

class ExportService {
  /**
   * Export to Reactive Resume and generate PDF
   * Maps to: Generate_ReactiveResume_PDF_From_Doc() in GenerateHTML.gs.ts
   */
  async exportToPdf(generatedDocument, template) {
    // 1. Build Reactive Resume JSON
    // 2. Import to Reactive Resume API
    // 3. Export PDF
    // 4. Download and store in cloud storage
    // 5. Return URL
  }

  /**
   * Build Reactive Resume JSON from generated document
   * Maps to: fillTemplateSectionBySection_() in GenerateHTML.gs.ts
   */
  buildReactiveResumeJson(generatedDocument, template) {
    // Transform internal format to RR format
  }

  /**
   * Validate and harden JSON for import
   * Maps to: validateAndHardenForImport_() in GenerateHTML.gs.ts
   */
  validateForImport(rrJson) {
    // Ensure all required fields exist
  }
}
```

### 5.4 Cover Letter Service

```javascript
// services/cover-letter.service.js

class CoverLetterService {
  /**
   * Generate cover letter
   * Maps to: generateOrUpdateCoverLetter() in GenerateCV.gs.ts
   */
  async generateCoverLetter(resumeId, jobDescriptionId, options) {
    // 1. Load resume and job description
    // 2. Call AI for body generation
    // 3. Format with date, greeting, closing
    // 4. Return structured result
  }
}
```

---

## 6. Data Flow

### 6.1 Resume Generation Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Client Request │────▶│  Rate Limiting   │────▶│  Auth Middleware│
│  POST /generate │     │  (in-app, 200/min)    │  JWT Validation │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Return URL    │◀────│  RabbitMQ Job   │◀────│  Generation     │
│   & Job Status  │     │  or Process Sync│     │  Controller     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                        ┌────────────────────────────────┴────────────┐
                        │                                              │
                        ▼                                              ▼
               ┌─────────────────┐                          ┌─────────────────┐
               │  Resume Service │                          │   Job Service   │
               │  (Load Master)  │                          │  (Load Job+KSAs)│
               └─────────────────┘                          └─────────────────┘
                        │                                              │
                        └─────────────────┬────────────────────────────┘
                                          │
                                          ▼
                               ┌─────────────────┐
                               │   AI Service    │
                               │  - Match KSAs   │
                               │  - Tailor Summary│
                               │  - Enhance Bullets│
                               └─────────────────┘
                                          │
                                          ▼
                               ┌─────────────────┐
                               │ Generated Doc   │
                               │   (MongoDB)     │
                               └─────────────────┘
                                          │
                                          ▼
                               ┌─────────────────┐
                               │  Export Service │
                               │  (Reactive Resume)│
                               └─────────────────┘
                                          │
                                          ▼
                               ┌─────────────────┐
                               │  Cloud Storage  │
                               │  (PDF Storage)  │
                               └─────────────────┘
```

### 6.2 Job Description Processing Flow

```
User Input: Raw Job Description Text
              │
              ▼
┌─────────────────────────────┐
│  POST /jobs + POST /jobs/:id/extract
└─────────────────────────────┘
              │
              ▼
┌─────────────────────────────┐
│  AI Service: Extract Fields │
│  - Title, Company           │
│  - KSAs (categorized)       │
│  - Acronyms (with expansion)│
│  - Requirements             │
│  - Responsibilities         │
└─────────────────────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Store in MongoDB           │
│  jobDescriptions collection │
└─────────────────────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Return Extracted Data      │
│  Ready for Generation       │
└─────────────────────────────┘
```

---

## 7. External Integrations

### 7.1 DeepSeek AI API

**Endpoint:** `https://api.deepseek.com/v1/chat/completions`

**Model:** `deepseek-chat`

**Use Cases:**
- Job field extraction
- Summary rewriting/tailoring
- Cover letter generation
- KSA semantic similarity checking
- Resume section extraction for Reactive Resume format

**Rate Limiting:** Implement exponential backoff and request queuing

### 7.2 Reactive Resume API (Self-Hosted)

Reactive Resume is **self-hosted** by the application (e.g. in the same Docker Compose or Kubernetes cluster) for PDF generation. No dependency on a third-party hosted instance.

**Endpoints (Reactive Resume OpenAPI):**
- `POST /api/openapi/resume/import` - Import resume JSON
- `GET /api/openapi/printer/resume/{id}/pdf` - Export as PDF

**Authentication:** Bearer token (`RXRESUME_API_KEY`), configured for the self-hosted instance.

**Integration Notes:**
- Template JSON must match Reactive Resume schema exactly
- Handle validation errors and provide meaningful feedback
- In development, run Reactive Resume via docker-compose; in production, deploy alongside the API (e.g. same K8s cluster)

### 7.3 Object Storage (for PDFs)

**Production:** AWS S3 (or S3-compatible storage).

**Development:** Local S3 simulator (e.g. MinIO or LocalStack) run via docker-compose so all dependencies run locally without AWS credentials.

**Requirements:**
- S3-compatible API so the same code works against real S3 or the local simulator
- Signed URLs for secure access
- Configurable expiration

---

## 8. Security Considerations

### 8.1 Authentication & Authorization

- **In-app:** The API service implements authentication and rate limiting itself (no separate API gateway required).
- JWT access tokens (15-minute expiry)
- Refresh tokens (7-day expiry, rotated on use)
- Role-based access control (RBAC) for enterprise features
- **Rate limiting:** Applied in-app. Default **200 requests per minute** per user (configurable via `RATE_LIMIT_REQUESTS_PER_MINUTE`). Returns `429 Too Many Requests` with `Retry-After` when exceeded.

### 8.2 Data Protection

- Encrypt API keys at rest (AES-256)
- TLS 1.3 for all API communication
- Sanitize all AI inputs/outputs to prevent prompt injection
- PII filtering in generated content

### 8.3 API Security

- Input validation on all endpoints (Zod/Joi schemas)
- Request size limits (prevent DoS)
- CORS configuration for allowed origins
- Security headers (Helmet.js)
- **Idempotency:** Generate and export endpoints accept optional `Idempotency-Key` header; duplicate keys within the retention window return the cached response without re-executing (see §4.6, §4.7).

### 8.4 Compliance Considerations

- GDPR: Data export, deletion, consent tracking
- CCPA: Similar privacy rights
- SOC 2: Audit logging, access controls

---

## 9. Implementation Roadmap

Each phase ends with **verification tests** that confirm that phase’s deliverables work before moving on. No “test after build” only at the end—testing is part of every stage.

### Phase 0: Web UI Shell (Week 0–1)

Build the frontend first as a non-functional shell so the backend can be built to support it.

- [ ] Next.js + React project for the web UI
- [ ] Pages/screens: login, register, dashboard, resume list/edit, job list/edit, generate (resume + cover letter), documents, settings
- [ ] UI components and layout; all API calls stubbed or failing (no backend yet)
- [ ] Routing and basic state so flows are navigable
- [ ] **Verification:** UI runs locally, all routes render; manual smoke test of navigation

### Phase 1: Foundation (Weeks 1–2)

- [ ] Project setup (Node.js, Express/Fastify, MongoDB connection)
- [ ] In-app authentication (JWT, refresh tokens) and rate limiting (configurable, default 200/min)
- [ ] User model and basic CRUD
- [ ] Resume model and basic CRUD
- [ ] API structure and routing
- [ ] **Verification:** Auth + rate-limit tests; resume CRUD integration tests; UI can call real auth and resume endpoints

### Phase 2: Core Features (Weeks 3–4)

- [ ] Job Description model and CRUD
- [ ] AI Service integration (DeepSeek)
- [ ] Job field extraction endpoint
- [ ] KSA matching logic
- [ ] Resume generation service (basic)
- [ ] **Verification:** Job CRUD and extract endpoint tests; generation smoke test (resume + job → generated document)

### Phase 3: Generation Engine (Weeks 5–6)

- [ ] Summary tailoring with AI
- [ ] Skill prioritization logic
- [ ] Bullet enhancement with KSAs
- [ ] Cover letter generation
- [ ] Generated documents storage
- [ ] **Verification:** End-to-end generation tests; cover letter and match analysis tests

### Phase 4: Export & Templates (Weeks 7–8)

- [ ] Self-hosted Reactive Resume in docker-compose (and optional K8s)
- [ ] Reactive Resume integration (import JSON, export PDF)
- [ ] PDF export service only
- [ ] Template model and management
- [ ] S3-compatible storage (real S3 or local simulator in dev)
- [ ] RabbitMQ and export queue for async processing
- [ ] Idempotency for generate and export endpoints
- [ ] **Verification:** Export PDF tests (sync and async); idempotency tests; full flow in docker-compose

### Phase 5: Polish & Scale (Weeks 9–10)

- [ ] Match analysis endpoint
- [ ] Bulk operations (jobs)
- [ ] Search and filtering
- [ ] Performance optimization
- [ ] Error handling and API documentation (OpenAPI/Swagger)
- [ ] **Verification:** Integration test suite; load/rate-limit checks; docs generated

### Phase 6: Deployment & Operations (Weeks 11–12)

- [ ] Kubernetes manifests (stateless API, workers, MongoDB, RabbitMQ, Reactive Resume, S3 or object store)
- [ ] Docker Compose for local dev (see §11)
- [ ] Monitoring and alerting
- [ ] **Verification:** Deploy to target K8s cluster; smoke tests in staging

---

## 10. Frontend (Web UI)

### 10.1 Stack

- **Framework:** React with Next.js (App Router).
- **Purpose:** Single web application for users to manage resumes, job descriptions, and generate tailored resumes and cover letters; export PDF only.

### 10.2 Build Strategy

- **Stage 0 (Phase 0):** Implement the UI as a shell first—all pages and flows present, API calls stubbed or pointing at not-yet-implemented endpoints. This defines the contract for the API; backend phases then implement the functionality behind each screen.
- **Later phases:** Replace stubs with real API calls and add loading/error states as endpoints become available.

### 10.3 Main Screens

- Auth: login, register, forgot password, reset password
- Dashboard: overview, quick actions
- Resumes: list, create, edit (sections: contact, summary, skills, experience, education, etc.)
- Jobs: list, create, edit, paste raw description, run extract
- Generate: select resume + job, trigger resume/cover letter generation, view match analysis
- Documents: list generated documents, download PDF
- Settings: profile, API keys (DeepSeek optional), default template, export preference (PDF)

### 10.4 API Consumption

- Next.js talks to the REST API (e.g. `NEXT_PUBLIC_API_URL`). Auth: send JWT in `Authorization`; handle 401 and refresh token flow. For idempotent operations (generate, export), UI may send a client-generated `Idempotency-Key` (e.g. UUID) to avoid duplicate work on retry.

---

## 11. Development Environment

All application components must be runnable **locally** via a **single docker-compose** so developers can work without cloud dependencies (except the DeepSeek API key).

### 11.1 Services in Docker Compose

| Service           | Purpose |
|------------------|--------|
| **api**          | Node.js REST API (Express/Fastify). |
| **web**          | Next.js frontend (dev server or production build). |
| **mongodb**      | MongoDB 7.x. |
| **rabbitmq**     | RabbitMQ for async job queue. |
| **reactive-resume** | Self-hosted Reactive Resume (e.g. official Docker image) for PDF export. |
| **s3**           | Local S3-compatible storage (MinIO or LocalStack). API and workers use this for PDF storage in dev. |

### 11.2 External Dependency

- **DeepSeek API:** Not run locally. Developers provide `DEEPSEEK_API_KEY` in env (e.g. `.env` or docker-compose `environment`). The API service uses it for all AI calls.

### 11.3 Running Locally

- `docker-compose up` (or `docker compose up`) brings up all services.
- API base URL for the UI: e.g. `http://api:4000` from inside Docker, or `http://localhost:4000` from the host if the API port is mapped.
- S3: use MinIO/LocalStack endpoint and credentials in env (e.g. `AWS_ENDPOINT=http://s3:9000`, bucket created on first run or via init script).
- Reactive Resume: URL and API key configured so the API and workers can call it (e.g. `RXRESUME_BASE_URL=http://reactive-resume:3000`).

### 11.4 One-Command Dev

- Optional: `docker-compose up` plus a single script or Compose profile that seeds a test user and optional sample data so a developer can open the UI and run through the main flow without manual setup.

---

## 12. Kubernetes Deployment

The **final destination** for the application is a **Kubernetes cluster**. All services must be designed to be **stateless** and horizontally scalable.

### 12.1 Stateless Design

- **API:** No in-memory session state; JWT and refresh tokens are validated per request; optional refresh token store in MongoDB. Rate limiting must work across replicas (e.g. store rate-limit counters in MongoDB or another shared store).
- **Workers:** Job consumers (RabbitMQ) are stateless; all context in the message and DB. Scale by adding more worker replicas.
- **UI:** Next.js can run as static export or server-rendered; no server-side session required; auth is via API tokens.

### 12.2 Cluster Components

- **API:** Deployment + Service; HPA optional; ingress for `/v1` and health.
- **Workers:** Deployment consuming from RabbitMQ (generation, export jobs).
- **Web:** Deployment + Service for Next.js (or serve static from ingress/CDN).
- **MongoDB:** Either cluster-managed (e.g. operator) or external; connection string via ConfigMap/Secret.
- **RabbitMQ:** Deployed in cluster or managed; connection via Secret.
- **Reactive Resume:** Self-hosted in the same cluster (Deployment + Service); internal URL for API/workers.
- **Object storage:** S3-compatible (e.g. AWS S3, MinIO in cluster, or external). Credentials via Secret.

### 12.3 Configuration

- Env and secrets (JWT, DB, RabbitMQ, DeepSeek, S3, Reactive Resume) via ConfigMaps and Secrets. No hardcoded credentials. Base URL and rate limit (e.g. `RATE_LIMIT_REQUESTS_PER_MINUTE`) configurable per environment.

---

## Appendix A: Request/Response Examples

### A.1 Generate Resume Request

```json
POST /v1/generate/resume
Authorization: Bearer <token>
Content-Type: application/json

{
  "resumeId": "6478a1b2c3d4e5f6a7b8c9d0",
  "jobDescriptionId": "6478a1b2c3d4e5f6a7b8c9d1",
  "templateId": "6478a1b2c3d4e5f6a7b8c9d2",
  "options": {
    "includeSections": ["summary", "experience", "education", "skills"],
    "maxSkills": 6,
    "bulletsPerJob": 3,
    "aiTemperature": 0.3
  }
}
```

### A.2 Generate Resume Response

```json
{
  "success": true,
  "data": {
    "documentId": "6478a1b2c3d4e5f6a7b8c9d3",
    "type": "resume",
    "matchAnalysis": {
      "overallScore": 78,
      "matchedKsas": 12,
      "totalKsas": 15
    },
    "exports": {
      "pdf": {
        "status": "processing",
        "estimatedTime": 30
      }
    },
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### A.3 Extract Job Fields Request

```json
POST /v1/jobs/extract
Authorization: Bearer <token>
Content-Type: application/json

{
  "rawText": "Senior Software Engineer at TechCorp...(full job description)..."
}
```

### A.4 Extract Job Fields Response

```json
{
  "success": true,
  "data": {
    "title": "Senior Software Engineer",
    "company": "TechCorp",
    "ksas": [
      { "term": "Python", "category": "technologies", "importance": "required" },
      { "term": "AWS", "category": "systems", "importance": "required" },
      { "term": "Agile/Scrum", "category": "processes", "importance": "preferred" }
    ],
    "acronyms": [
      { "acronym": "AWS", "expansion": "Amazon Web Services" },
      { "acronym": "CI/CD", "expansion": "Continuous Integration/Continuous Deployment" }
    ],
    "experienceLevel": "senior",
    "employmentType": "full-time"
  }
}
```

---

## Appendix B: Environment Variables

```env
# Server
NODE_ENV=development
PORT=4000
API_VERSION=v1

# Rate limiting (in-app)
RATE_LIMIT_REQUESTS_PER_MINUTE=200

# MongoDB
MONGODB_URI=mongodb://localhost:27017/resumegen
MONGODB_DB_NAME=resumegen

# Authentication
JWT_SECRET=your-super-secret-key
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your-refresh-secret
REFRESH_TOKEN_EXPIRES_IN=7d
****
# AI Services (required; no local substitute)
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TEMPERATURE=0.3

# Reactive Resume (self-hosted; in dev use docker-compose URL)
RXRESUME_BASE_URL=http://reactive-resume:3000
RXRESUME_API_KEY=your-rx-api-key

# Object storage (S3-compatible; in dev use MinIO/LocalStack)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=resumegen-exports
AWS_REGION=us-east-1
# For local dev: AWS_ENDPOINT=http://minio:9000 (or LocalStack URL)

# RabbitMQ (message queue)
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672

# Encryption
ENCRYPTION_KEY=32-byte-encryption-key

# Logging
LOG_LEVEL=info
```

---

*Document Version: 1.1*
*Last Updated: February 2026*

*Changelog (1.1):* In-app auth and rate limiting; RabbitMQ for queue (no Redis); no caching; self-hosted Reactive Resume; idempotency for generate/export; rate limit 200/min configurable; Phase 0 UI (React+Next.js) and per-phase verification tests; PDF-only export; Development (Docker Compose, local S3); Kubernetes deployment (stateless).
