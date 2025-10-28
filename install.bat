@echo off
echo 🚀 Setting up Multi-Vendor E-commerce Platform...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

echo ✅ Node.js and npm are installed

REM Install backend dependencies
echo 📦 Installing backend dependencies...
npm install

REM Create .env file if it doesn't exist
if not exist .env (
    echo 📝 Creating .env file...
    copy .env.example .env
    echo ⚠️  Please update the .env file with your configuration values
)

REM Install frontend dependencies
echo 📦 Installing frontend dependencies...
cd frontend
npm install

REM Install Tailwind CSS
echo 🎨 Setting up Tailwind CSS...
npx tailwindcss init -p

cd ..

echo.
echo 🎉 Installation completed!
echo.
echo 📋 Next steps:
echo 1. Update the .env file with your configuration values
echo 2. Start MongoDB (local or configure MongoDB Atlas)
echo 3. Run 'npm run dev' to start the backend server
echo 4. Run 'cd frontend && npm start' to start the frontend
echo.
echo 🌐 Backend will run on: http://localhost:5000
echo 🌐 Frontend will run on: http://localhost:3000
echo.
echo 📚 For more information, check the README.md file
pause 