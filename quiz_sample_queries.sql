-- Sample SQL Queries for Quiz Tracking System
-- These queries demonstrate analytics and reporting capabilities

-- 1. LEADERBOARD QUERY: Top 10 students by score for a specific quiz exam
-- Parameters: quiz_id (UUID)
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
  WHERE qa.quiz_id = $1 -- Replace with actual quiz ID
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

-- 2. PIE CHART DATA: Score distribution by category for a quiz exam
-- Parameters: quiz_id (UUID)
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
  WHERE quiz_id = $1 -- Replace with actual quiz ID
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

-- 3. MONTHLY AVERAGE SCORE PER COURSE
-- Parameters: year (INT), month (INT)
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
    AND EXTRACT(YEAR FROM qa.submitted_at) = $1 -- year parameter
    AND EXTRACT(MONTH FROM qa.submitted_at) = $2 -- month parameter
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

-- 4. BONUS QUERY: Student Progress Over Time for a Course
-- Parameters: course_id (UUID), user_id (UUID)
SELECT 
  q.month_number,
  q.title as quiz_title,
  qa.score,
  qa.total_marks,
  qa.percentage,
  qa.rank,
  qa.submitted_at,
  LAG(qa.percentage) OVER (ORDER BY q.month_number, qa.submitted_at) as previous_percentage,
  qa.percentage - LAG(qa.percentage) OVER (ORDER BY q.month_number, qa.submitted_at) as improvement
FROM quiz_exams q
JOIN quiz_exam_attempts qa ON q.id = qa.quiz_id
WHERE q.course_id = $1 -- course_id parameter
  AND qa.user_id = $2 -- user_id parameter
  AND qa.submitted_at IS NOT NULL
ORDER BY q.month_number, qa.submitted_at;

-- 5. BONUS QUERY: Quiz Difficulty Analysis
-- Parameters: course_id (UUID)
SELECT 
  qq.difficulty,
  COUNT(*) as question_count,
  ROUND(AVG(qq.marks), 2) as avg_marks_per_question,
  COUNT(DISTINCT q.id) as quizzes_with_this_difficulty,
  ROUND(AVG(qa.percentage), 2) as avg_student_performance
FROM quiz_exam_questions qq
JOIN quiz_exams q ON qq.quiz_id = q.id
LEFT JOIN quiz_exam_attempts qa ON q.id = qa.quiz_id AND qa.submitted_at IS NOT NULL
WHERE q.course_id = $1 -- course_id parameter
GROUP BY qq.difficulty
ORDER BY 
  CASE qq.difficulty
    WHEN 'EASY' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'HARD' THEN 3
  END;

-- 6. BONUS QUERY: Most Challenging Questions (Lowest Success Rate)
-- Parameters: quiz_id (UUID)
WITH question_performance AS (
  SELECT 
    qq.id as question_id,
    qq.question_text,
    qq.difficulty,
    qq.marks,
    COUNT(qa.id) as total_attempts,
    COUNT(CASE 
      WHEN (qa.details->>qq.id::text) = qq.correct_answer 
      THEN 1 
    END) as correct_attempts,
    ROUND(
      COUNT(CASE 
        WHEN (qa.details->>qq.id::text) = qq.correct_answer 
        THEN 1 
      END) * 100.0 / NULLIF(COUNT(qa.id), 0), 
      2
    ) as success_rate
  FROM quiz_exam_questions qq
  LEFT JOIN quiz_exam_attempts qa ON qq.quiz_id = qa.quiz_id 
    AND qa.submitted_at IS NOT NULL
  WHERE qq.quiz_id = $1 -- quiz_id parameter
  GROUP BY qq.id, qq.question_text, qq.difficulty, qq.marks
)
SELECT 
  question_text,
  difficulty,
  marks,
  total_attempts,
  correct_attempts,
  success_rate
FROM question_performance
WHERE total_attempts > 0
ORDER BY success_rate ASC, total_attempts DESC
LIMIT 10;
