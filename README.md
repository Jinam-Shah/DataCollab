# DataCollab - Real-time Collaborative Data Analysis Platform

[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue)](https://github.com/Jinam-Shah/DataCollab)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A full-stack web application that enables teams to upload CSV files, run SQL queries, generate insights with AI, and collaborate in real-time through chat and live query broadcasting.

![Dashboard](./screenshots/dashboard.png)

## 📸 Screenshots

### Login & Registration
![Login Page](./screenshots/login.png)
*User authentication with workspace support*

### File Management
![File Upload](./screenshots/file-upload.png)
*Drag-and-drop CSV upload with automatic schema detection*

![File Preview](./screenshots/file-preview.png)
*Data preview with column types and sample values*

### SQL Query Editor
![Query Editor](./screenshots/query-editor.png)
*Monaco editor with syntax highlighting and sample queries*

![Query Results](./screenshots/query-results.png)
*Paginated results with execution time*

### AI-Powered Text-to-SQL
![AI Text to SQL](./screenshots/ai-text-to-sql.png)
*Natural language questions converted to SQL*

### Data Visualizations
![Visualizations](./screenshots/visualizations.png)
*Interactive bar, line, and pie charts*

### Real-time Collaboration
![Real-time Chat](./screenshots/chat.png)
*Live chat with team members in the same workspace*

---

## ✨ Features

### Core Functionality
- **CSV File Upload & Management**: Drag-and-drop CSV files with automatic schema detection
- **SQL Query Editor**: Monaco-powered editor with syntax highlighting
- **AI-Powered Text-to-SQL**: Convert natural language questions to SQL queries using Google Gemini API
- **Real-time Collaboration**: Live chat and query execution broadcasting with Socket.io
- **Data Visualizations**: Create bar charts, line charts, and pie charts from query results
- **Workspace-based Collaboration**: Teams share files and collaborate within isolated workspaces

### Technical Highlights
- **Dynamic Table Creation**: Automatically creates PostgreSQL tables for uploaded CSV files
- **Schema Detection**: Identifies INTEGER, FLOAT, TEXT, and DATE data types
- **Query Validation**: Prevents dangerous SQL operations (DROP, DELETE on system tables)
- **Real-time Updates**: Instant file uploads, query results, and chat messages across users
- **JWT Authentication**: Secure token-based authentication with 7-day expiration

---

## 🛠️ Tech Stack

### Backend
- **Node.js** + **Express.js** - REST API server
- **PostgreSQL** - Relational database for data storage
- **Socket.io** - Real-time WebSocket communication
- **JWT** - Token-based authentication
- **Multer** - File upload handling
- **csv-parser** - CSV parsing and validation
- **bcrypt** - Password hashing
- **Axios** - HTTP client for Gemini API

### Frontend
- **React** (JavaScript) - UI framework
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first styling
- **Monaco Editor** - SQL code editor
- **Recharts** - Data visualization library
- **Socket.io Client** - Real-time communication
- **Axios** - API requests

### AI Integration
- **Google Gemini API** - Natural language to SQL conversion

---

## 📁 Project Structure
```
datacollab/
├── backend/
│   ├── config/
│   │   └── database.js          # PostgreSQL connection pool
│   ├── controllers/
│   │   ├── authController.js    # User registration/login
│   │   ├── fileController.js    # CSV upload/management
│   │   ├── queryController.js   # SQL execution
│   │   ├── aiController.js      # Text-to-SQL generation
│   │   └── chatController.js    # Real-time chat
│   ├── middleware/
│   │   └── auth.js              # JWT verification
│   ├── models/
│   │   └── User.js              # User database operations
│   ├── routes/
│   │   ├── auth.js
│   │   ├── files.js
│   │   ├── queries.js
│   │   ├── ai.js
│   │   └── chat.js
│   ├── services/
│   │   ├── csvService.js        # CSV parsing & table creation
│   │   ├── sqlService.js        # SQL execution & validation
│   │   └── geminiService.js     # Gemini API integration
│   ├── uploads/                 # Temporary file storage
│   ├── .env.example             # Environment variables template
│   └── server.js                # Main entry point
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Auth/
│   │   │   ├── FileUpload/
│   │   │   ├── QueryEditor/
│   │   │   ├── AIQuery/
│   │   │   ├── Visualizations/
│   │   │   └── Chat/
│   │   ├── pages/
│   │   ├── services/
│   │   └── utils/
│   ├── .env.example             # Frontend environment template
│   └── public/
├── screenshots/                  # Application screenshots
└── README.md
```

---

## 🗄️ Database Schema
```sql
-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    workspace_id VARCHAR(50) DEFAULT 'default',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CSV files metadata
CREATE TABLE csv_files (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename VARCHAR(255) NOT NULL,
    file_size INTEGER NOT NULL,
    row_count INTEGER,
    column_count INTEGER,
    workspace_id VARCHAR(50),
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- CSV column schema information
CREATE TABLE csv_columns (
    id SERIAL PRIMARY KEY,
    file_id INTEGER REFERENCES csv_files(id) ON DELETE CASCADE,
    column_name VARCHAR(255) NOT NULL,
    data_type VARCHAR(50) NOT NULL,
    column_index INTEGER NOT NULL,
    sample_values TEXT[]
);

-- Chat messages
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_users_workspace ON users(workspace_id);
CREATE INDEX idx_csv_files_user ON csv_files(user_id);
CREATE INDEX idx_csv_files_workspace ON csv_files(workspace_id);
CREATE INDEX idx_csv_columns_file ON csv_columns(file_id);
CREATE INDEX idx_chat_messages_sent ON chat_messages(sent_at DESC);

-- Dynamic tables: csv_data_{file_id} created at runtime for each uploaded CSV
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+ 
- PostgreSQL 14+
- Google Gemini API key ([Get free key](https://aistudio.google.com/app/apikey))

### 1. Clone Repository
```bash
git clone https://github.com/Jinam-Shah/DataCollab.git
cd DataCollab
```

---

### 2. Backend Setup
```bash
cd backend
npm install
```

**Configure environment variables:**
```bash
# Copy example file
cp .env.example .env

# Edit .env with your values
```

**Required environment variables (see `backend/.env.example`):**
```env
PORT=5000
DATABASE_URL=postgresql://username:password@localhost:5432/datacollab
DATABASE_READER_URL=postgresql://datacollab_reader:another_password@localhost:5432/datacollab
JWT_SECRET=your_super_secret_key_here
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=development
```

**Create the database and run migrations:**
```bash
createdb datacollab          # or: psql -U postgres -c "CREATE DATABASE datacollab"
npm run migrate              # applies backend/db/migrations in order
```

**Start backend server:**
```bash
npm run dev
```

Backend runs on `http://localhost:5000`

---

### 3. Frontend Setup
```bash
cd ../frontend
npm install
```

**Configure environment variables:**
```bash
# Copy example file
cp .env.example .env

# Edit .env with your values
```

**Required environment variables (see `frontend/.env.example`):**
```env
VITE_API_URL=http://localhost:5000
VITE_SOCKET_URL=http://localhost:5000
```

**Start development server (Vite):**
```bash
npm run dev
```

Frontend runs on `http://localhost:3000`

---

## 📖 Usage Guide

### 1. Register & Login
- Navigate to `http://localhost:3000`
- Create an account with username, email, and password
- Optionally specify a **workspace ID** for team collaboration
- Users with the same workspace ID share files and can collaborate

### 2. Upload CSV Files
- Drag and drop CSV files onto the upload area
- Files are automatically parsed and validated
- View detected schema (column names and data types)
- See preview of first 100 rows

### 3. Run SQL Queries
- Select a file from the list
- Write SQL queries in the Monaco editor with syntax highlighting
- Use pre-built sample queries for quick starts
- Click "Run Query" to execute
- View results in a paginated table with execution time

### 4. AI Text-to-SQL
- Type natural language questions in the AI input box
- Examples: 
  - "Show employees with salary above 80000"
  - "Count total rows"
  - "Find average age by department"
- AI generates SQL query automatically
- Review and modify generated SQL before execution

### 5. Create Visualizations
- After running a query, scroll to "Visualize Results"
- Select chart type: Bar, Line, or Pie chart
- Choose X-axis (categories) and Y-axis (values) from query columns
- Charts update instantly and display first 20 rows

### 6. Real-time Collaboration
- Open chat sidebar on the right
- Send messages to team members in your workspace
- See live notifications when others upload files or run queries
- All users in the same workspace see updates instantly

---

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/profile` - Get current user (protected)

### Files
- `POST /api/files/upload` - Upload CSV file (protected)
- `GET /api/files` - List all files in workspace (protected)
- `GET /api/files/:id` - Get file details with preview (protected)
- `DELETE /api/files/:id` - Delete file (protected)

### Queries
- `POST /api/queries/execute` - Execute SQL query (protected)
- `GET /api/queries/schema/:tableName` - Get table schema (protected)
- `GET /api/queries/samples/:fileId` - Get sample queries (protected)

### AI
- `POST /api/ai/text-to-sql` - Generate SQL from natural language (protected)

### Chat
- `GET /api/chat/messages` - Get recent messages (protected)
- `POST /api/chat/messages` - Send message (protected)

---

## 🔒 Security Features

User and AI-generated SQL runs through a layered safety path. Details and limits: [docs/SECURITY.md](docs/SECURITY.md).

- **Per-workspace schemas** (`ws_<id>`) for uploaded tables
- **Read-only role** with SELECT only on one workspace, a 5 s statement timeout and read-only transactions
- **Single-statement check** with PostgreSQL's own parser (`libpg-query`), plus the keyword denylist as a second layer
- **Row cap** of 1000 rows per page with pagination
- **Workspace checks** on every file endpoint and authenticated, per-workspace Socket.io rooms
- **Password hashing** with bcrypt, **JWT** with 7-day expiry

---

## 🔮 Future Enhancements

- [ ] Query history and favorites
- [ ] Excel/JSON file support
- [ ] Advanced chart customization (colors, legends)
- [ ] Scheduled query execution
- [ ] Data export (CSV, PDF, Excel)
- [ ] User presence indicators (online/offline status)
- [ ] Live cursor tracking in editor
- [ ] Mobile responsive design
- [ ] Docker containerization
- [ ] CI/CD pipeline with GitHub Actions
- [ ] Rate limiting for API endpoints
- [ ] Query result caching
- [ ] Multi-factor authentication

---

## 👨‍💻 Author

**Jinam Shah**  

[![GitHub](https://img.shields.io/badge/GitHub-@Jinam--Shah-181717?logo=github)](https://github.com/Jinam-Shah)


**Skills Demonstrated:**
- Full-stack JavaScript development (Node.js, React)
- Database design and SQL optimization
- Real-time communication with WebSockets
- RESTful API development
- AI/LLM integration
- Authentication and security
- Git version control

---

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details

---

## 🙏 Acknowledgments

- [Google Gemini API](https://ai.google.dev/) for AI-powered text-to-SQL
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) by Microsoft
- [Recharts](https://recharts.org/) visualization library
- [Socket.io](https://socket.io/) for real-time communication
- [Tailwind CSS](https://tailwindcss.com/) for styling
---

## 📞 Contact & Feedback

If you have any questions or feedback about this project:
- Open an issue on [GitHub](https://github.com/Jinam-Shah/DataCollab/issues)

**Star this repository if you found it helpful!** ⭐