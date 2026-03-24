import { useState } from 'react'
import { useReveal } from '../hooks/useReveal'
import { Send, Mail, ExternalLink } from 'lucide-react'
import './Contact.css'

export default function Contact() {
  const titleRef = useReveal()
  const formRef = useReveal(0.1)

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    type: '',
    message: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    /*
     * TODO: Connect to Formspree or EmailJS
     *
     * Formspree setup:
     * 1. Go to https://formspree.io and create an account
     * 2. Create a new form and get your form ID
     * 3. Replace the action URL below with: https://formspree.io/f/YOUR_FORM_ID
     *
     * Then uncomment the fetch below and remove the simulated submission.
     */

    // const res = await fetch('https://formspree.io/f/YOUR_FORM_ID', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(formData),
    // })
    // if (res.ok) setSubmitted(true)

    // Simulated submission for now
    setSubmitted(true)
  }

  return (
    <section className="section contact" id="contact">
      <div className="section-inner">
        <div className="contact-grid">
          <div className="contact-info reveal" ref={titleRef}>
            <span className="section-label">Get in Touch</span>
            <h2 className="section-title">Let's Build Something</h2>
            <div className="contact-audiences">
              <p className="contact-audience">
                <strong>Exploring new roles?</strong> I'm looking for opportunities
                in Solutions Engineering and AI.
              </p>
              <p className="contact-audience">
                <strong>Ready for AI?</strong> I'd love to hear about your business
                and find the right fit.
              </p>
            </div>

            <div className="contact-direct">
              {/* TODO: Update email when professional domain is set up */}
              <a href="mailto:joesh.sethi39@gmail.com" className="contact-link">
                <Mail size={16} />
                joesh.sethi39@gmail.com
              </a>
              {/* TODO: Update LinkedIn URL when confirmed */}
              <a
                href="https://linkedin.com/in/joeshsethi"
                target="_blank"
                rel="noopener noreferrer"
                className="contact-link"
              >
                <ExternalLink size={16} />
                linkedin.com/in/joeshsethi
              </a>
            </div>

            {/* TODO: Add Calendly embed here when account is set up */}
          </div>

          <div className="contact-form-wrap reveal" ref={formRef}>
            {submitted ? (
              <div className="contact-success">
                <h3>Message sent!</h3>
                <p>Thanks for reaching out. I'll get back to you soon.</p>
              </div>
            ) : (
              <form className="contact-form" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="name">Name</label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Your name"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email">Email</label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    placeholder="you@email.com"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="type">What brings you here?</label>
                  <select
                    id="type"
                    name="type"
                    required
                    value={formData.type}
                    onChange={handleChange}
                  >
                    <option value="" disabled>Select one...</option>
                    <option value="job">Job Opportunity</option>
                    <option value="business">Business Inquiry</option>
                    <option value="hello">Just Saying Hi</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="message">Message</label>
                  <textarea
                    id="message"
                    name="message"
                    required
                    rows={5}
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Tell me what you're working on..."
                  />
                </div>
                <button type="submit" className="btn btn-primary form-submit">
                  <Send size={16} />
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
