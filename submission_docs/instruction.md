AI Automation Assignment – Full Stack AI Web Developer
Objective
Your task is to choose a specific role within a specific industry and automate it using AI. For example, you could select an executive assistant, social media manager, salesperson, recruiter, or product manager, among others. The role and industry are entirely up to you - what matters is your ability to design and implement a valuable AI-driven automation solution.
Step 1: Research & Breakdown
Once you’ve chosen a role, conduct in-depth research into its core responsibilities and functionalities. Then:
Break the role down into sub-functionalities to better understand its workflows and dependencies.
Prioritize functions and workstreams based on impact, focusing on maximizing the value your AI agent provides.
Step 2: Solution Design & Documentation
Based on your research, create a structured document (SRS, solution design, or functional specifications) that outlines:
The role you chose and why.
The key tasks and workflows your AI agent will handle.
A high-level architecture and technical approach, including both frontend and backend components.
Any third-party APIs or integrations you plan to use.
How the agent will automate tasks and take meaningful actions (e.g., sending emails, scheduling tasks, setting reminders, etc.), with considerations for user interaction via the UI.
You should use this document as your implementation guide. Please make sure to submit it as part of your final deliverables. Make sure to send it to kidus@brain3.ai for a review/approval before getting started.
You can generate your own Gemini API key through Google AI Studio and use GCP Always Free Tier resources to begin building.
Step 3: Build & Implement
Develop your AI agent using any tech stack of your choice. The agent should:
Automate tasks relevant to the role.
Integrate with at least a couple of free, relevant third-party APIs.
Ideally, take proactive actions (e.g., using Cloud Scheduler to automatically check in with users or trigger events).
Since this is a full stack-focused role, your application should include a balanced frontend (e.g., a responsive web UI built with React, Vue, or similar) and robust backend (e.g., Node.js, Python Flask/Django, or similar), with the primary focus on seamless integration, automation, and end-to-end functionality.
Step 4: Presentation & Submission
Once your project is complete, submit the following before midnight the next day and send your submission to kidus@brain3.ai:
A video recording where you:
Explain the problem statement and your thought process.
Walk through your problem-solving approach and solution design.
Demonstrate the AI agent in action, including interactions via the UI.
Provide a high-level code walkthrough of both frontend and backend.
Your source code and relevant documentation.
Examples & Clarifications
To ensure your project aligns with expectations, here are examples of what to aim for and what to avoid:
What to Aim For
Example 1: Executive Assistant Automation
Role & Industry: Executive assistant in a tech startup.
Tasks Automated: Scheduling meetings, sending follow-up emails, and managing task reminders.
Implementation: The AI agent uses Google Calendar API (free tier) to schedule meetings based on availability, SendGrid API (free tier) to send automated follow-up emails, and Cloud Scheduler (GCP Always Free Tier, up to 3 jobs/month) to trigger daily task reminders. The agent processes natural language inputs (e.g., “Schedule a meeting with John next week”) using the Gemini API free tier via Google AI Studio. The frontend is a simple web app (e.g., built with React) allowing users to input commands and view schedules, dashboards, or notifications in real-time.
Why It Works: The agent automates high-impact, repetitive tasks, integrates multiple free APIs, uses free GCP resources for proactive actions, and provides an intuitive UI for user engagement, all without requiring a credit card.
Example 2: Social Media Manager Automation
Role & Industry: Social media manager for an e-commerce brand.
Tasks Automated: Generating and scheduling social media posts, analyzing engagement metrics.
Implementation: The AI agent uses the Gemini API free tier to generate engaging post content, integrates with the Twitter API (free tier) to schedule posts, and pulls engagement data from a free analytics API. It runs daily checks via Cloud Scheduler (GCP Always Free Tier) to post at optimal times, hosted on Cloud Run (GCP Always Free Tier, up to 180,000 vCPU-seconds/month). The frontend is a web dashboard (e.g., using Vue.js) where users can preview generated posts, approve schedules, and visualize analytics charts.
Why It Works: The solution targets measurable outcomes (engagement), automates a clear workflow, leverages free tier resources, and includes a user-friendly interface for monitoring and interaction, ensuring accessibility without a credit card.
What to Avoid
Pitfall 1: Overly Broad or Vague Automation
Example: Choosing “customer service” and building a generic chatbot that only answers FAQs without specific integrations or proactive actions.
Why It Fails: Lacks focus on a specific role’s workflows, doesn’t integrate relevant APIs, and provides limited value compared to existing solutions.
Fix: Narrow the scope to a specific customer service task (e.g., automating ticket triage for a SaaS company) and integrate free APIs like Zendesk (free tier) for ticket management, with a UI for viewing and escalating tickets.
Pitfall 2: Imbalanced Frontend/Backend Development
Example: Building a recruiter automation tool with a highly polished frontend dashboard but a backend that only handles basic data storage without meaningful automations or integrations.
Why It Fails: The assignment requires a full stack approach, so neglecting either side (e.g., weak backend logic or poor UI usability) undermines the end-to-end solution.
Fix: Ensure balanced development, such as integrating LinkedIn API free tier for candidate sourcing on the backend while providing a responsive UI for searching, viewing profiles, and triggering automated outreach.
Pitfall 3: Ignoring Free Tier Limits
Example: Using GCP services like Cloud SQL (no free tier) or exceeding Always Free Tier limits (e.g., Compute Engine’s 1 GB egress/month), requiring a billing account.
Why It Fails: Requires a credit card, which conflicts with the assignment’s accessibility goal.
Fix: Stick to Always Free Tier services (e.g., Cloud Functions, Cloud Run, Cloud Scheduler) and verify third-party API free tier limits.
What Not to Do
Please avoid selecting a role in HR or Recruiting. While these are valid fields for automation, they are common choices that often lead to similar, predictable solutions. To best evaluate your potential, I want to see you tackle a problem in a different domain. This pushes you to think more creatively from first principles and demonstrate your ability to architect a novel solution, rather than applying a common template. Your choice of role is the first and most critical demonstration of your problem-solving mindset.
Evaluation Criteria
I will assess your work based on:
Value proposition – Would I be willing to pay for this agent?
Automation effectiveness – Would I hire your AI agent over a human for this role?
Technical execution – How well you designed, built, and integrated the solution, including frontend-backend harmony.
Problem-solving & adaptability – Your ability to thrive in ambiguity and handle multiple aspects of the project, as expected in a startup environment.
Additional Notes
Avoid choosing recruiter related roles as the APIs needed to make a meaningful demo require payments.
Your purpose should be to demonstrate your skills, creativity and problem solving so be laser focused on delivering super quality work.
You can generate a Gemini API key for free via Google AI Studio (ai.google.dev) without a credit card. Sign in with a Google account, click “Get API Key,” and select “Create API key in new project.” The free tier (e.g., Gemini 2.5 Flash, up to 15 requests/minute or 1,500 requests/day) is sufficient for this assignment.
You can use GCP Always Free Tier resources (e.g., Cloud Functions: 2 million invocations/month; Cloud Run: 180,000 vCPU-seconds/month; Cloud Scheduler: 3 jobs/month) without a credit card by creating a GCP project without enabling billing. Ensure your project stays within these limits to avoid needing a billing account.
The two required third-party APIs must be free (e.g., Google Calendar API, SendGrid free tier, Twitter API free tier). Verify their free tier limits to ensure compatibility with your project.
If you face issues generating the Gemini API key or accessing GCP Always Free Tier (e.g., regional restrictions), message me on LinkedIn for guidance.
You are free to use any AI tools to accelerate development.
If you have questions, message me on LinkedIn, and I’ll do my best to respond promptly.
Good luck - you got this! 💯💪🏽🔥🚀👍🏽


