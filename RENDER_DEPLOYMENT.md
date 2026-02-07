# Render Deployment Guide

This guide will help you deploy the Study Buddy project to Render.

## Prerequisites

Before deploying, ensure you have:
1. A GitHub account
2. A Render account (free tier available)
3. A Google Gemini API key (get it from [Google AI Studio](https://aistudio.google.com/app/apikey))

## Step 1: Prepare Your Repository

### 1a. Initialize Git (if not already done)
```bash
cd /workspaces/Study-Buddy-Deployment
git init
git add .
git commit -m "Initial commit for Render deployment"
```

### 1b. Push to GitHub
```bash
# Create a new repository on GitHub
# Then push your code:
git remote add origin https://github.com/YOUR_USERNAME/Study-Buddy-Deployment.git
git branch -M main
git push -u origin main
```

## Step 2: Create Render Account and Connect GitHub

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Sign up or log in with your GitHub account
3. Click "New +" and select "Web Service"
4. Connect your GitHub repository "Study-Buddy-Deployment"
5. Select the repository

## Step 3: Configure Deployment Settings on Render

### Service Configuration:
- **Name**: `study-buddy` (or your preferred name)
- **Environment**: `Node`
- **Region**: Select your preferred region
- **Branch**: `main`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`
- **Plan**: Free tier (recommended for testing)

## Step 4: Add Environment Variables

In the Render dashboard, go to **Environment** section and add:

```
GEMINI_API_KEY=your_gemini_key_here
NODE_ENV=production
```

### How to get GEMINI_API_KEY:
1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Paste it in the GEMINI_API_KEY field on Render

## Step 5: Deploy

1. Click the "Deploy" button on Render
2. Monitor the deployment in the Logs tab
3. Once complete, Render will provide your live URL

## Important Notes

### Next.js Configuration
The project is already configured for serverless deployment:
- `pages/api/` routes work as serverless functions on Render
- The build and start commands are optimized for production
- Maximum timeout is set to 5 minutes for PDF processing

### File Size Limits
- Render free tier has a 500MB disk limit
- PDFs should be under 25MB (Gemini API limit)
- Static files (`.next` build output) take ~100MB

### Performance Tips
1. **Upgrade to Paid Plan** if you need:
   - Higher concurrency (free tier: 1 concurrent request)
   - Persistent storage
   - Better performance
   - Higher timeouts for large PDF processing

2. **Optimize PDFs**: Compress PDFs before uploading for faster processing

3. **Monitor Logs**: Check Render's logs for any API errors

## Step 6: Post-Deployment Testing

1. Access your app at: `https://study-buddy.onrender.com` (or your Render URL)
2. Test PDF upload functionality
3. Verify questions generate correctly
4. Check PDF download works

## Troubleshooting

### Deployment Fails
- Check logs in Render dashboard
- Ensure all dependencies are in `package.json`
- Verify Node version is compatible (14+)

### API Errors (400/401)
- Verify GEMINI_API_KEY is correct
- Check API quota on Google Cloud Console
- Ensure no typos in environment variable names

### Slow Performance
- Large PDFs may timeout on free tier (5 min limit)
- Consider upgrading to paid plan
- Split large PDFs into smaller files

### Build Size Too Large
- Run `npm run build` locally and check `.next` folder size
- Consider image optimization
- Use next/image for image optimization

## Scaling Up

To upgrade your deployment:
1. Go to Render dashboard → Select your service
2. Click "Settings" → "Plan"
3. Upgrade to "Starter" or higher tier
4. Increased resources include:
   - Concurrent requests
   - Processing timeout (up to 10 min)
   - Memory and CPU

## Environment Variables Reference

```bash
# Required
GEMINI_API_KEY=your_api_key_here

# Optional (automatic on Render)
NODE_ENV=production
```

## Additional Resources

- [Render Documentation](https://render.com/docs)
- [Next.js Deployment Guide](https://nextjs.org/docs/deployment)
- [Google Generative AI API Docs](https://ai.google.dev/docs)

## Support

If you encounter issues:
1. Check Render logs: Dashboard → Services → study-buddy → Logs
2. Test locally: `npm run build && npm start`
3. Check environment variables are set correctly
4. Review API usage on Google Cloud Console
