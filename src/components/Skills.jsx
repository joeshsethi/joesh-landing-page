import { useReveal } from '../hooks/useReveal'
import './Skills.css'

const clientSkills = [
  'Live Product Demos',
  'Design Thinking Workshops',
  'Stakeholder Management',
  'Executive Presentations',
  'Solution Roadmapping',
  'Client Relationship Management',
  'Japanese (Fluent)',
]

const techSkills = [
  { label: 'OpenAI / GPT', ai: true },
  { label: 'Claude AI', ai: true },
  { label: 'Pinecone', ai: true },
  { label: 'Stable Diffusion', ai: true },
  { label: 'LangChain', ai: true },
  { label: 'Python', ai: false },
  { label: 'SQL', ai: false },
  { label: 'Java', ai: false },
  { label: 'HTML / CSS', ai: false },
  { label: 'AWS', ai: false },
  { label: 'Azure', ai: false },
  { label: 'GitHub', ai: false },
  { label: 'Agile / Scrum', ai: false },
  { label: 'Jira', ai: false },
  { label: 'Salesforce', ai: false },
]

export default function Skills() {
  const titleRef = useReveal()
  const gridRef = useReveal(0.1)

  return (
    <section className="section skills" id="skills">
      <div className="section-inner">
        <div className="reveal" ref={titleRef}>
          <span className="section-label">The Toolkit</span>
          <h2 className="section-title">Skills & Technology</h2>
        </div>

        <div className="skills-grid reveal" ref={gridRef}>
          <div className="skills-col">
            <h3 className="skills-col-title">Client-Facing</h3>
            <div className="skills-pills">
              {clientSkills.map(skill => (
                <span className={`skill-pill ${skill === 'Japanese (Fluent)' ? 'skill-pill--ai' : ''}`} key={skill}>{skill}</span>
              ))}
            </div>
          </div>

          <div className="skills-col">
            <h3 className="skills-col-title">Technical</h3>
            <div className="skills-pills">
              {techSkills.map(({ label, ai }) => (
                <span className={`skill-pill ${ai ? 'skill-pill--ai' : ''}`} key={label}>
                  {label}
                </span>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
