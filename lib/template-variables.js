/**
 * Known input variables for each prompt template.
 * Used by the AI Test UI to show hints and pre-fill example values
 * even when the template text is still a placeholder.
 */
export const TEMPLATE_VARIABLES = {
  "brand-visual-identity-extractor": {
    description: "Extracts a structured brand identity profile from brand information.",
    variables: {
      name: "Bloom Studio",
      businessType: "Creative Agency",
      mainServicesOrProducts: "Brand identity, social media content, and digital marketing for small businesses",
      targetAudience: "Small business owners aged 28–45 looking to grow their online presence",
      brandTone: "Warm, approachable, and creatively inspiring",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      website: "https://bloomstudio.example.com",
    },
  },

  "reference-image-information-extractor": {
    description: "Analyses a reference image and extracts its visual DNA (color, composition, mood, etc.). Attach or describe the image.",
    variables: {
      imageDescription: "A flat-lay photo of a coffee cup, notebook, and succulents on a white marble surface. Soft natural light from the left. Warm beige tones, clean and minimal.",
    },
  },

  "image-reference-and-brand-identity-combiner": {
    description: "Combines brand identity data and reference image analysis into a unified visual direction.",
    variables: {
      brandIdentitySummary: "Warm minimalist brand targeting small business owners. Earthy tones, clean typography, approachable tone.",
      referenceImageAnalysis: "Soft natural lighting, warm beige palette (#F5EFE6, #E8D5B7), flat-lay composition, minimal props.",
      textRequirements: "Logo in top-right corner, one short headline (max 6 words)",
      attractionNotes: "Needs to feel aspirational but accessible. Not corporate.",
    },
  },

  "image-prompt-booster-raw-idea": {
    description: "Expands a raw image idea into a detailed, optimised AI image generation prompt.",
    variables: {
      rawIdea: "A woman working at a cozy home office desk with plants and warm lighting",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      platform: "Instagram",
      format: "Square post (1:1)",
    },
  },

  "video-storyboard-generator": {
    description: "Generates a structured scene-by-scene storyboard before the final video prompt is built.",
    variables: {
      brandName: "Bloom Studio",
      platform: "Instagram Reels",
      format: "15-second reel",
      mainAngleAndCoreMessage: "Show how Bloom Studio transforms a bland brand into something memorable in 3 steps",
      visualDirection: "Warm, fast-paced montage. Show before/after of brand assets.",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      targetAudience: "Small business owners aged 28–45",
    },
  },

  "video-prompt-enhancer-raw-idea": {
    description: "Turns a raw video idea into a detailed, ready-to-use video generation prompt for tools like Higgsfield.",
    variables: {
      rawIdea: "A time-lapse of a designer creating a brand identity from sketch to finished logo",
      platform: "Instagram Reels",
      format: "30-second vertical video",
      duration: "30 seconds",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      // Cinematic Controls — requested values (or "Auto — infer from context")
      speedRamp: "Auto",
      cameraMovement: "Dolly in",
      camera: "Auto",
      lens: "Auto",
      focalLength: "35",
      aperture: "f/4 moderate",
    },
  },

  "post-suggestor": {
    description: "Suggests post ideas for a content calendar based on brand info, monthly goal, and research inputs.",
    variables: {
      brandName: "Bloom Studio",
      brandTone: "Warm, approachable, and creatively inspiring",
      targetAudience: "Small business owners aged 28–45 looking to grow their online presence",
      mainServicesOrProducts: "Brand identity, social media content, and digital marketing",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      brandIdentitySummary: "[Brand identity JSON or summary — auto-filled from saved identity]",
      platform: "Instagram",
      monthlyObjective: "Increase engagement by 20% and promote new brand audit service",
      calendarPeriod: "June 2026 — 4 weeks",
      numberOfPosts: "12",
      popularIndustryPosts: "Before/after transformations, behind-the-scenes, tips series, client spotlights",
      importantIndustryWebsites: "designmilk.com, creativebloq.com, awwwards.com",
      competitorPages: "@competitor1, @competitor2",
      campaignEvents: "Brand awareness week June 10–14",
      offers: "Free 30-min brand audit for new followers in June",
      seasonalDates: "Summer solstice June 21, Father's Day June 15",
      contentLimitations: "No stock photos, authentic storytelling only",
      additionalNotes: "Focus on the transformation story — before and after working with us",
    },
  },

  "content-calendar-generator": {
    description: "Generates a structured content calendar using brand info, selected post ideas, and content strategy rules.",
    variables: {
      brandName: "Bloom Studio",
      brandTone: "Warm, approachable, and creatively inspiring",
      targetAudience: "Small business owners aged 28–45",
      mainServicesOrProducts: "Brand identity, social media content, and digital marketing",
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      brandIdentitySummary: "[Auto-filled from saved brand identity]",
      selectedPostIdeas: "[Auto-filled from selected post ideas in previous step]",
      mainMonthlySubject: "Brand identity and the power of visual storytelling",
      mainLandingPageOrServicePage: "https://bloomstudio.example.com/brand-audit",
      mainGoal: "Build trust, grow engagement, and drive brand audit inquiries",
      mainOfferOrMessage: "Free 30-min brand audit for new followers in June",
      importantDetailsToInclude: "We've worked with 200+ small businesses. Before/after results. Local Austin focus.",
      detailsNotToInvent: "Do not make up specific statistics. Do not use stock imagery. Do not claim medical or legal expertise.",
      sourceMaterial: "Recent blog: '3 signs your brand needs a refresh'. Client case study: Fitness studio rebrand.",
      priorityContentIdeas: "Client transformation story, myth-busting post, team behind-the-scenes, question post",
      platforms: "Instagram",
      numberOfPostsNeeded: "12",
      publishingFrequency: "3 posts per week — Monday, Wednesday, Friday",
      requiredPostFormats: "4 Carousels, 4 Reels, 3 Static posts, 1 Story",
      videoCreationTool: "Canva for short clips + Reels templates",
      videoProductionLimitation: "No professional camera. Only phone footage and screen recordings.",
      contentStrategyRules: "Every 3rd post must be educational. Always include a soft CTA. No hard selling.",
      audienceLanguageRules: "Write in English. Casual but professional. No jargon. Use 'you' and 'your brand'.",
      writingStyleRules: "Short sentences. Use line breaks. Max 3 hashtags per caption. Always end with a question.",
    },
  },

  "image-prompt-from-brand-and-post-without-reference": {
    description: "Generates an image prompt from brand identity and post details — no reference image needed.",
    variables: {
      brandVisualStyle: "Clean minimalism with earthy tones and bold typography",
      visualDirection: "Flat-lay of brand design tools on a warm desk surface",
      outputImageTextRequirements: "Overlay text: 'Your brand, elevated.' in bold sans-serif",
      platform: "Instagram",
      format: "Square post (1:1)",
    },
  },
};
