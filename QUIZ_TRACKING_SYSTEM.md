# Quiz Tracking System Documentation

## Overview

This document describes the comprehensive quiz tracking system designed for the LMS platform. The system provides complete quiz management, attempt tracking, and analytics capabilities.

## Database Schema

### Core Tables

#### 1. `quiz_exams` - Quiz Metadata
- **Purpose**: Stores quiz configuration and metadata
- **Key Fields**:
  - `id`: UUID primary key
  - `course_id`: Links to course
  - `month_number`: Course month (1-6)
  - `lesson_id`: Optional link to specific lesson
  - `title`: Quiz title
  - `total_marks`: Total possible marks
  - `duration_minutes`: Time limit (default 30)
  - `is_active`: Enable/disable quiz

#### 2. `quiz_exam_questions` - Individual Questions
- **Purpose**: Stores quiz questions with options and answers
- **Key Fields**:
  - `id`: UUID primary key
  - `quiz_id`: Links to quiz_exams
  - `question_text`: The question content
  - `options`: JSONB array of answer choices
  - `correct_answer`: Correct answer key
  - `marks`: Points for this question
  - `difficulty`: ENUM (EASY, MEDIUM, HARD)

#### 3. `quiz_exam_attempts` - User Attempts
- **Purpose**: Tracks user quiz attempts and scores
- **Key Fields**:
  - `id`: UUID primary key
  - `quiz_id`: Links to quiz_exams
  - `user_id`: Links to users
  - `score`: User's score
  - `total_marks`: Total possible marks
  - `percentage`: Calculated percentage
  - `started_at`: When attempt began
  - `submitted_at`: When attempt was submitted
  - `rank`: User's rank in this quiz
  - `details`: JSONB storing user answers

#### 4. `quiz_exam_analytics` - Performance Cache
- **Purpose**: Cached analytics for quick reporting
- **Key Fields**:
  - `id`: UUID primary key
  - `quiz_id`: Links to quiz_exams (unique)
  - `average_score`: Average percentage
  - `highest_score`: Best performance
  - `lowest_score`: Worst performance
  - `total_attempts`: Number of attempts
  - `topper_id`: User with highest score

## Prisma Models

### QuizExam Model
```prisma
model QuizExam {
  id               String   @id @default(uuid())
  courseId         String
  monthNumber      Int
  lessonId         String?
  title            String
  totalMarks       Int      @default(0)
  durationMinutes  Int      @default(30)
  isActive         Boolean  @default(true)
  createdAt        DateTime @default(now())
  
  // Relations
  course           Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  lesson           CourseContent? @relation(fields: [lessonId], references: [id], onDelete: SetNull)
  questions        QuizExamQuestion[]
  attempts         QuizExamAttempt[]
  analytics        QuizExamAnalytics?
  
  @@index([courseId])
  @@index([monthNumber])
  @@index([lessonId])
  @@index([isActive])
  @@index([createdAt])
  @@index([courseId, monthNumber])
}
```

### QuizExamQuestion Model
```prisma
model QuizExamQuestion {
  id             String         @id @default(uuid())
  quizId         String
  questionText   String
  options        Json           // JSONB array of answer choices
  correctAnswer  String
  marks          Int            @default(1)
  difficulty     DifficultyLevel @default(MEDIUM)
  createdAt      DateTime       @default(now())
  
  // Relations
  quiz           QuizExam       @relation(fields: [quizId], references: [id], onDelete: Cascade)
  
  @@index([quizId])
  @@index([difficulty])
  @@index([createdAt])
}
```

### QuizExamAttempt Model
```prisma
model QuizExamAttempt {
  id           String    @id @default(uuid())
  quizId       String
  userId       String
  score        Int       @default(0)
  totalMarks   Int       @default(0)
  percentage   Float     @default(0.0)
  startedAt    DateTime  @default(now())
  submittedAt  DateTime?
  rank         Int?
  details      Json      @default("{}") // JSONB object storing user answers
  
  // Relations
  quiz         QuizExam  @relation(fields: [quizId], references: [id], onDelete: Cascade)
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([quizId])
  @@index([userId])
  @@index([score])
  @@index([percentage])
  @@index([rank])
  @@index([submittedAt])
  @@index([quizId, userId])
  @@index([quizId, score])
}
```

### QuizExamAnalytics Model
```prisma
model QuizExamAnalytics {
  id            String   @id @default(uuid())
  quizId        String   @unique
  averageScore  Float    @default(0.0)
  highestScore  Float    @default(0.0)
  lowestScore   Float    @default(0.0)
  totalAttempts Int      @default(0)
  topperId      String?
  createdAt     DateTime @default(now())
  
  // Relations
  quiz          QuizExam @relation(fields: [quizId], references: [id], onDelete: Cascade)
  topper        User?    @relation(fields: [topperId], references: [id], onDelete: SetNull)
  
  @@index([quizId])
  @@index([topperId])
  @@index([createdAt])
}
```

## Key Features

### 1. **Flexible Question Types**
- Multiple choice questions with JSONB options
- Configurable difficulty levels
- Customizable marks per question

### 2. **Comprehensive Tracking**
- User attempt tracking with timestamps
- Detailed answer storage in JSONB format
- Automatic rank calculation
- Score and percentage tracking

### 3. **Performance Analytics**
- Cached analytics for fast reporting
- Average, highest, and lowest scores
- Total attempt counts
- Topper identification

### 4. **Course Integration**
- Links to specific courses and months
- Optional lesson-level association
- Course-based quiz organization

## Sample Queries

### 1. Leaderboard Query
```sql
-- Top 10 students by score for a specific quiz
WITH quiz_leaderboard AS (
  SELECT 
    qa.user_id,
    u.name as student_name,
    u.email as student_email,
    qa.score,
    qa.total_marks,
    qa.percentage,
    qa.rank,
    qa.submitted_at,
    ROW_NUMBER() OVER (ORDER BY qa.score DESC, qa.submitted_at ASC) as position
  FROM quiz_exam_attempts qa
  JOIN users u ON qa.user_id = u.id
  WHERE qa.quiz_id = $1
    AND qa.submitted_at IS NOT NULL
)
SELECT 
  position,
  student_name,
  student_email,
  score,
  total_marks,
  percentage,
  submitted_at
FROM quiz_leaderboard
ORDER BY position
LIMIT 10;
```

### 2. Score Distribution Query
```sql
-- Pie chart data for score distribution
WITH score_categories AS (
  SELECT 
    CASE 
      WHEN percentage >= 90 THEN 'Excellent (90-100%)'
      WHEN percentage >= 80 THEN 'Good (80-89%)'
      WHEN percentage >= 70 THEN 'Average (70-79%)'
      WHEN percentage >= 60 THEN 'Below Average (60-69%)'
      ELSE 'Poor (Below 60%)'
    END as category,
    COUNT(*) as student_count,
    ROUND(AVG(percentage), 2) as avg_percentage_in_category
  FROM quiz_exam_attempts
  WHERE quiz_id = $1
    AND submitted_at IS NOT NULL
  GROUP BY 
    CASE 
      WHEN percentage >= 90 THEN 'Excellent (90-100%)'
      WHEN percentage >= 80 THEN 'Good (80-89%)'
      WHEN percentage >= 70 THEN 'Average (70-79%)'
      WHEN percentage >= 60 THEN 'Below Average (60-69%)'
      ELSE 'Poor (Below 60%)'
    END
)
SELECT 
  category,
  student_count,
  avg_percentage_in_category,
  ROUND((student_count * 100.0 / SUM(student_count) OVER ()), 2) as percentage_of_total
FROM score_categories
ORDER BY 
  CASE category
    WHEN 'Excellent (90-100%)' THEN 1
    WHEN 'Good (80-89%)' THEN 2
    WHEN 'Average (70-79%)' THEN 3
    WHEN 'Below Average (60-69%)' THEN 4
    WHEN 'Poor (Below 60%)' THEN 5
  END;
```

### 3. Monthly Performance Query
```sql
-- Monthly average score per course
WITH monthly_quiz_stats AS (
  SELECT 
    c.id as course_id,
    c.title as course_title,
    c.slug as course_slug,
    q.month_number,
    COUNT(DISTINCT q.id) as total_quizzes,
    COUNT(qa.id) as total_attempts,
    ROUND(AVG(qa.percentage), 2) as avg_percentage,
    ROUND(AVG(qa.score), 2) as avg_score,
    MAX(qa.percentage) as highest_percentage,
    MIN(qa.percentage) as lowest_percentage
  FROM courses c
  JOIN quiz_exams q ON c.id = q.course_id
  LEFT JOIN quiz_exam_attempts qa ON q.id = qa.quiz_id 
    AND qa.submitted_at IS NOT NULL
    AND EXTRACT(YEAR FROM qa.submitted_at) = $1
    AND EXTRACT(MONTH FROM qa.submitted_at) = $2
  WHERE q.is_active = true
  GROUP BY c.id, c.title, c.slug, q.month_number
)
SELECT 
  course_title,
  course_slug,
  month_number,
  total_quizzes,
  total_attempts,
  avg_percentage,
  avg_score,
  highest_percentage,
  lowest_percentage,
  CASE 
    WHEN total_attempts = 0 THEN 'No attempts'
    WHEN avg_percentage >= 80 THEN 'High Performance'
    WHEN avg_percentage >= 60 THEN 'Moderate Performance'
    ELSE 'Low Performance'
  END as performance_category
FROM monthly_quiz_stats
ORDER BY course_title, month_number;
```

## Integration Notes

### Existing System Compatibility
- The new quiz system is designed to work alongside the existing `Quiz` and `QuizCollection` models
- New models use `QuizExam` naming to avoid conflicts
- Existing quiz creation, update, and deletion functionality remains unchanged
- The system integrates with existing course and user management

### API Endpoints
The system will require new API endpoints for:
- Quiz exam creation and management
- Question management
- Attempt tracking
- Analytics retrieval
- Leaderboard generation

### Frontend Integration
- Quiz exam interface for students
- Admin panel for quiz management
- Analytics dashboard for performance tracking
- Real-time attempt monitoring

## Performance Considerations

### Indexing Strategy
- Comprehensive indexing on foreign keys
- Performance indexes on frequently queried fields
- Composite indexes for complex queries
- Unique constraints for data integrity

### Caching Strategy
- Analytics table for cached performance metrics
- Regular updates to maintain accuracy
- Efficient query patterns for real-time data

### Scalability
- JSONB for flexible data storage
- Efficient foreign key relationships
- Optimized query patterns
- Proper constraint definitions

## Security Considerations

- Foreign key constraints ensure data integrity
- Cascade deletes for dependent data
- Proper user authentication for attempts
- Secure answer storage in JSONB format

## Future Enhancements

1. **Advanced Question Types**: Support for different question formats
2. **Time-based Analytics**: Historical performance tracking
3. **Adaptive Quizzing**: Dynamic difficulty adjustment
4. **Bulk Operations**: Mass quiz creation and management
5. **Export Features**: Data export for external analysis
6. **Notification System**: Real-time quiz updates and reminders

## Conclusion

This quiz tracking system provides a robust foundation for comprehensive quiz management in the LMS platform. It offers flexibility, performance, and scalability while maintaining compatibility with existing systems. The design follows PostgreSQL best practices and provides extensive analytics capabilities for educational insights.
