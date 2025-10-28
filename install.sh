#!/bin/bash

echo "🚀 Setting up Multi-Vendor E-commerce Platform..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ Node.js and npm are installed"

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "⚠️  Please update the .env file with your configuration values"
fi

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install

# Install Tailwind CSS
echo "🎨 Setting up Tailwind CSS..."
npx tailwindcss init -p

cd ..

echo ""
echo "🎉 Installation completed!"
echo ""
echo "📋 Next steps:"
echo "1. Update the .env file with your configuration values"
echo "2. Start MongoDB (local or configure MongoDB Atlas)"
echo "3. Run 'npm run dev' to start the backend server"
echo "4. Run 'cd frontend && npm start' to start the frontend"
echo ""
echo "🌐 Backend will run on: http://localhost:5000"
echo "🌐 Frontend will run on: http://localhost:3000"
echo ""
echo "📚 For more information, check the README.md file" 