import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '@/lib/mongodb';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, studentClass, subject, suggestions } = req.body;

    if (!name || !studentClass || !subject) {
      return res.status(400).json({ error: 'Name, class, and subject are required.' });
    }

    const client = await clientPromise;
    const db = client.db('studybuddy');
    const collection = db.collection('feedbacks');

    await collection.insertOne({
      name: name.trim(),
      studentClass,
      subject,
      suggestions: suggestions?.trim() || '',
      createdAt: new Date(),
    });

    return res.status(201).json({ success: true });
  } catch (error: any) {
    console.error('Feedback save error:', error);
    return res.status(500).json({ error: 'Failed to save feedback. Please try again.' });
  }
}
