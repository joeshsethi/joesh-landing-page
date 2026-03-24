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
  'OpenAI / GPT',
  'Claude AI',
  'Pinecone',
  'Stable Diffusion',
  'LangChain',
  'Python',
  'SQL',
  'Java',
  'HTML / CSS',
  'AWS',
  'Azure',
  'GitHub',
  'Agile / Scrum',
  'Jira',
  'Salesforce',
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
                <span className="skill-pill" key={skill}>{skill}</span>
              ))}
            </div>
          </div>

          <div className="skills-col">
            <h3 className="skills-col-title">Technical</h3>
            <div className="skills-pills">
              {techSkills.map(skill => (
                <span className="skill-pill" key={skill}>{skill}</span>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
