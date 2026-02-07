#!/bin/bash

# Render Deployment Helper Script
# This script helps you prepare and deploy the Study Buddy project to Render

echo "🚀 Study Buddy - Render Deployment Helper"
echo "=========================================="
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git repository not initialized"
    echo "Run: git init && git add . && git commit -m 'Initial commit'"
    exit 1
fi

echo "✅ Git repository found"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi

echo "✅ package.json found"

# Check if render.yaml exists
if [ ! -f "render.yaml" ]; then
    echo "❌ render.yaml not found"
    exit 1
fi

echo "✅ render.yaml found"

echo ""
echo "📋 Pre-deployment Checklist:"
echo "✅ Git repository initialized"
echo "✅ Configuration files present"
echo ""

echo "📝 Next Steps:"
echo "1. Ensure your code is pushed to GitHub:"
echo "   git remote add origin https://github.com/YOUR_USERNAME/Study-Buddy-Deployment.git"
echo "   git push -u origin main"
echo ""
echo "2. Go to https://dashboard.render.com"
echo "3. Click 'New +' → 'Web Service'"
echo "4. Connect your GitHub repository"
echo "5. Configure as:"
echo "   - Build Command: npm install && npm run build"
echo "   - Start Command: npm start"
echo ""
echo "6. Add Environment Variables:"
echo "   GEMINI_API_KEY=<your_key_from_https://aistudio.google.com/app/apikey>"
echo "   NODE_ENV=production"
echo ""
echo "7. Click 'Deploy'"
echo ""
echo "📚 For detailed instructions, see: RENDER_DEPLOYMENT.md"
echo ""
