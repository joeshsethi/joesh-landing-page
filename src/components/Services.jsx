import { useReveal } from '../hooks/useReveal'
import { Globe, Share2, Megaphone, GraduationCap, Lightbulb } from 'lucide-react'
import './Services.css'

const services = [
  {
    icon: Globe,
    title: 'Custom Website Design & Build',
    desc: 'Get a website that actually works as hard as you do. Clean, fast, and built to convert visitors into customers.',
  },
  {
    icon: Share2,
    title: 'Social Media Content Automation',
    desc: 'Never run out of content again — AI handles the posts, you handle the business.',
  },
  {
    icon: Megaphone,
    title: 'AI-Powered Marketing Materials',
    desc: 'Ads, flyers, and copy that speak to your customers — generated in minutes, not days.',
  },
  {
    icon: GraduationCap,
    title: 'Staff AI Training',
    desc: 'Teach your team to use AI tools like ChatGPT and Claude — without the confusion or the jargon.',
  },
  {
    icon: Lightbulb,
    title: 'AI Tools Consulting & Advisory',
    desc: 'Not sure where to start with AI? Let\'s find the right tools for your business together.',
  },
]

export default function Services() {
  const titleRef = useReveal()
  const cardsRef = useReveal(0.1)

  return (
    <section className="section services" id="services">
      <div className="section-inner">
        <div className="reveal" ref={titleRef}>
          <span className="section-label">What I Do</span>
          <h2 className="section-title">What I Bring to the Table</h2>
          <p className="section-subtitle">
            Enterprise-tested, small-business-priced. The same AI expertise
            behind Fortune 500 solutions — now accessible to businesses of every size.
          </p>
        </div>

        <div className="services-grid reveal reveal-stagger" ref={cardsRef}>
          {services.map(({ icon: Icon, title, desc }) => (
            <div className="service-card" key={title}>
              <div className="service-icon">
                <Icon size={22} strokeWidth={1.5} />
              </div>
              <h3 className="service-title">{title}</h3>
              <p className="service-desc">{desc}</p>
            </div>
          ))}
        </div>

        <p className="services-bridge reveal" ref={useReveal()}>
          Whether you're a Fortune 500 or a family-owned restaurant —
          technology should work for you, not the other way around.
        </p>
      </div>
    </section>
  )
}
