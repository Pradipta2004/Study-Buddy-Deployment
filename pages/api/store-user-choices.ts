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
    const {
      studentClass,
      subject,
      difficulty,
      mode,
      questionsByType,
      questionsByMarks,
      customInstructions,
    } = req.body;

    // Validate required fields
    if (!studentClass || !subject || !difficulty || !mode) {
      return res.status(400).json({
        error: 'studentClass, subject, difficulty, and mode are required.',
      });
    }

    const client = await clientPromise;
    const db = client.db('studybuddy');
    const collection = db.collection('user_choices');

    // Prepare the document
    const choicesDoc = {
      studentClass,
      subject,
      difficulty,
      mode,
      customInstructions: customInstructions || null,
      // Only store question config if not pattern mode
      ...(mode !== 'pattern' && {
        questionsByType: questionsByType || null,
        questionsByMarks: questionsByMarks || null,
      }),
      createdAt: new Date(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    };

    // Insert the document
    const result = await collection.insertOne(choicesDoc);

    return res.status(201).json({
      success: true,
      id: result.insertedId,
    });
  } catch (error: any) {
    console.error('User choices save error:', error);
    return res.status(500).json({
      error: 'Failed to save user choices. Please try again.',
    });
  }
}
